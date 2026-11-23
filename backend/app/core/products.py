"""Which documents describe the same product, so that a difference between them is a real conflict.

Two policies from different insurers (or two different products of one insurer) are expected to differ: "30 days" in one
and "60 days" in another is a comparison, not a contradiction. A conflict is only meaningful between documents that are
versions or parts of the same product (a policy wording and its schedule, v1 and v2), or within one document.

Identity, strongest signal first:
  1. IRDAI UIN (e.g. LIBHLGP22010V032122): insurer code + product code + version. Same product code = same product.
  2. Issuer: from the UIN prefix, else a known insurer name in the title, else the company that page 1 names
     ("Sunrise Co-operative Bank Ltd.", "Suraksha General Insurance Co. Ltd."). Different issuers -> never a conflict.
  3. Product name: the title minus the insurer's name and generic words ("policy", "wordings", ...).
When no issuer can be found at all, the pair stays eligible and the model decides, as before. Within one issuer the
product-name test applies only to insurers' products (UIN or a known insurer): a bank's master policy and its key facts
statement have different names but must still agree.
"""

import re
from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, Sentence

# product code = everything before the version: LIBHLGP22010 V 032122
UIN = re.compile(r"\b([A-Z]{3}[A-Z]{2,6}\d{5})V\d{6}\b")
_UIN_SQL = r"[A-Z]{3}[A-Z]{2,6}[0-9]{5}V[0-9]{6}"

# insurer key -> names as they appear in titles (lowercase); UIN prefix -> insurer key
INSURERS = {
    "newindia": ["new india"], "unitedindia": ["united india"], "national": ["national insurance"],
    "oriental": ["oriental insurance"], "hdfcergo": ["hdfc ergo", "hdfc"], "icicilombard": ["icici lombard", "icici"],
    "bajaj": ["bajaj allianz", "bajaj general", "bajaj"], "tataaig": ["tata aig", "tata"], "sbi": ["sbi general", "sbi"],
    "liberty": ["liberty general", "liberty"], "nivabupa": ["niva bupa", "max bupa"], "star": ["star health"],
    "care": ["care health", "religare"], "adityabirla": ["aditya birla"], "manipalcigna": ["manipalcigna", "manipal cigna"],
    "reliance": ["reliance general"], "futuregenerali": ["future generali"], "iffcotokio": ["iffco tokio", "iffco-tokio"],
    "chola": ["cholamandalam", "chola ms"], "royalsundaram": ["royal sundaram"], "universalsompo": ["universal sompo"],
    "kotak": ["kotak mahindra general", "kotak"], "digit": ["go digit"], "acko": ["acko"],
    "magma": ["magma hdi"], "zuno": ["zuno", "edelweiss general"], "shriram": ["shriram general"],
    "navi": ["navi general"], "galaxy": ["galaxy health"], "narayana": ["narayana health"],
}
UIN_PREFIX = {
    "NIA": "newindia", "UII": "unitedindia", "NIC": "national", "OIC": "oriental", "HDF": "hdfcergo",
    "ICI": "icicilombard", "BAJ": "bajaj", "TAT": "tataaig", "SBI": "sbi", "LIB": "liberty", "MAX": "nivabupa",
    "NBH": "nivabupa", "SHA": "star", "RHI": "care", "ADI": "adityabirla", "MCI": "manipalcigna", "RSL": "reliance",
    "FGI": "futuregenerali", "ITG": "iffcotokio", "CHO": "chola", "RSA": "royalsundaram", "USG": "universalsompo",
    "KOT": "kotak", "GOD": "digit", "ACK": "acko", "MAG": "magma", "EDL": "zuno", "SGI": "shriram",
}
# words that name a document's form, not the product
_GENERIC = set("policy policies wording wordings insurance document terms conditions and the of for schedule "
               "certificate prospectus brochure endorsement annexure clauses plan general company limited ltd co "
               "india indian".split())
# a company named on page 1: up to five capitalised words, then "Co. Ltd" / "Ltd" / "Limited"
_ORG = re.compile(r"\b((?:[A-Z][A-Za-z&\-]+\s+){1,5})(?:Co\.?\s+|Company\s+|Pvt\.?\s+)?(?:Ltd\b\.?|Limited\b|LTD\b\.?|LIMITED\b)")
_ORG_SKIP = {"the", "m", "s", "messrs", "between", "and", "by", "from", "for", "to", "with", "of", "issued", "dated", "whereas"}
_ALIAS = sorted(((a, k) for k, names in INSURERS.items() for a in names), key=lambda t: -len(t[0]))


@dataclass(frozen=True)
class Product:
    insurer: str | None
    code: str | None          # UIN without its version
    name: frozenset[str]      # product-name words from the title


def _norm(text: str) -> str:
    return " " + " ".join(re.findall(r"[a-z0-9\-]+", text.lower())) + " "


def issuer_from_text(head: str) -> str | None:
    """The issuer named on page 1: a known insurer, else the most often named company (first one on a tie)."""
    low = _norm(head)
    known = next((k for a, k in _ALIAS if f" {a} " in low), None)
    if known:
        return known
    names = [w for m in _ORG.findall(head) for w in [next((x for x in m.split() if x.lower() not in _ORG_SKIP), "")] if w]
    return f"org:{Counter(n.lower() for n in names).most_common(1)[0][0]}" if names else None


def identify(title: str, uins: list[str], head: str = "") -> Product:
    code = Counter(uins).most_common(1)[0][0] if uins else None
    low = _norm(title)
    insurer = UIN_PREFIX.get(code[:3]) if code else None
    if insurer is None:
        insurer = next((k for a, k in _ALIAS if f" {a} " in low), None)
    if insurer is None and code:
        insurer = f"uin:{code[:3]}"  # unknown prefix: still comparable with other UINs
    if insurer is None and head:
        # page 1 opens with the title, whose capitalised words would run into the company name: drop it first
        insurer = issuer_from_text(head.replace(title, " ") if title.strip() else head)
    for a, k in _ALIAS:
        if k == insurer:
            low = low.replace(f" {a} ", " ")
    name = frozenset(w for w in re.findall(r"[a-z]+", low) if w not in _GENERIC and len(w) > 1)
    return Product(insurer, code, name)


def same_product(a: Product, b: Product) -> bool:
    """False only when the documents are known to be different products; unknown identity -> True."""
    if a.code and b.code:
        return a.code == b.code
    if a.insurer and b.insurer and a.insurer != b.insurer:
        return False
    insurance = a.code or (a.insurer and not a.insurer.startswith("org:"))
    if insurance and a.insurer == b.insurer and a.name and b.name and not (a.name <= b.name or b.name <= a.name):
        return False
    return True


_cache: dict[tuple[str, str], Product] = {}


async def products(session: AsyncSession, doc_ids) -> dict[str, Product]:
    """Product identity per document (cached: a document's text never changes; a rename changes the key)."""
    ids = set(doc_ids)
    if not ids:
        return {}
    titles = dict((await session.execute(select(Document.id, Document.title).where(Document.id.in_(ids)))).all())
    out, todo = {}, []
    for d, t in titles.items():
        if (d, t) in _cache:
            out[d] = _cache[(d, t)]
        else:
            todo.append(d)
    if todo:
        uins: dict[str, list[str]] = {d: [] for d in todo}
        rows = await session.execute(select(Sentence.document_id, Sentence.text).where(
            Sentence.document_id.in_(todo), Sentence.text.op("~")(_UIN_SQL)))
        for d, text in rows.all():
            uins[d].extend(UIN.findall(text))
        heads: dict[str, list[str]] = {d: [] for d in todo}
        rows = await session.execute(select(Sentence.document_id, Sentence.text).where(
            Sentence.document_id.in_(todo), Sentence.page == 1).order_by(Sentence.document_id, Sentence.ord))
        for d, text in rows.all():
            if len(heads[d]) < 12:  # the title block and opening lines
                heads[d].append(text)
        for d in todo:
            out[d] = _cache[(d, titles[d])] = identify(titles[d], uins[d], " ".join(heads[d]))
    return out


def relation(prods: dict[str, Product], doc_a: str, doc_b: str) -> str:
    """What is known for certain about how two documents relate, for the model that confirms a conflict: without it a
    mis-parsed heading ("7. Group Super Top up") reads as a different product and a real conflict is dismissed."""
    if doc_a == doc_b:
        return "both clauses are from the same document"
    pa, pb = prods.get(doc_a), prods.get(doc_b)
    if pa and pb and pa.code and pa.code == pb.code:
        return f"both documents are the same product (UIN {pa.code})"
    if pa and pb and pa.insurer and pa.insurer == pb.insurer:
        return "both documents are from the same issuer"
    return ""


def related(prods: dict[str, Product], doc_a: str, doc_b: str) -> bool:
    """Can a difference between these two documents be a conflict? (same document, same product, or unknown)"""
    if doc_a == doc_b:
        return True
    pa, pb = prods.get(doc_a), prods.get(doc_b)
    return pa is None or pb is None or same_product(pa, pb)


def named_in(question: str, titles: dict[str, str], prods: dict[str, Product]) -> list[set[str]]:
    """The documents a question names, one set per named document or product (pure: no DB).

    - A document's full title in the question names that document alone ("in the Policy Wordings document").
    - An issuer's name ("New India", "Liberty", "Sunrise") names that issuer's documents; when some of them have
      product-name words all present in the question ("Niva Bupa *Group Health*"), only those. Each named document
      brings the other documents of its product (same UIN product code): "the Liberty group health policy" is both
      the wording and its companion with the same UIN.
    """
    low = _norm(question)
    groups: list[set[str]] = []

    def add(g: set[str]) -> None:
        if g and g not in groups:
            groups.append(g)

    for d, t in titles.items():
        nt = _norm(t).strip()
        if len(nt) >= 8 and f" {nt} " in low:
            add({d})
    by_issuer: dict[str, list[str]] = {}
    for d, p in prods.items():
        if p.insurer and d in titles:
            by_issuer.setdefault(p.insurer, []).append(d)
    for ins, ds in by_issuer.items():
        aliases = [a for a, k in _ALIAS if k == ins] or ([ins[4:]] if ins.startswith("org:") else [])
        # the words just after each mention of the issuer: "Niva Bupa [group health policies]", not the whole
        # question (in "New India Assurance and Niva Bupa Group Health", 'assurance' is New India's)
        near: set[str] = set()
        for a in aliases:
            for m in re.finditer(f" {re.escape(a)} ", low):
                near |= set(re.findall(r"[a-z]+", " ".join(low[m.end():].split()[:6])))
        if not near and not any(f" {a} " in low for a in aliases):
            continue
        fit = [d for d in ds if prods[d].name and prods[d].name <= near]
        for d in fit or ds:
            code = prods[d].code
            add({x for x in ds if x == d or (code and prods[x].code == code)})
    return groups


async def named_documents(session: AsyncSession, question: str, doc_ids=None) -> list[set[str]]:
    """named_in() over the active documents in scope (a chat's, or all)."""
    q = select(Document.id, Document.title).where(Document.active.is_(True))
    if doc_ids is not None:
        q = q.where(Document.id.in_(list(doc_ids)))
    titles = dict((await session.execute(q)).all())
    return named_in(question, titles, await products(session, titles))
