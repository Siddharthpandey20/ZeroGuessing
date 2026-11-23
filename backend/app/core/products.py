"""Which documents describe the same product, so that a difference between them is a real conflict.

Two policies from different insurers (or two different products of one insurer) are expected to differ: "30 days" in one
and "60 days" in another is a comparison, not a contradiction. A conflict is only meaningful between documents that are
versions or parts of the same product (a policy wording and its schedule, v1 and v2), or within one document.

Identity, strongest signal first:
  1. IRDAI UIN (e.g. LIBHLGP22010V032122): insurer code + product code + version. Same product code = same product.
  2. Insurer: from the UIN prefix, else a known insurer name in the title.
  3. Product name: the title minus the insurer's name and generic words ("policy", "wordings", ...).
When an identity cannot be established (an unknown issuer, as in the demo bank's documents), the pair stays eligible
and the model decides, as before.
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
_ALIAS = sorted(((a, k) for k, names in INSURERS.items() for a in names), key=lambda t: -len(t[0]))


@dataclass(frozen=True)
class Product:
    insurer: str | None
    code: str | None          # UIN without its version
    name: frozenset[str]      # product-name words from the title


def identify(title: str, uins: list[str]) -> Product:
    code = Counter(uins).most_common(1)[0][0] if uins else None
    low = " " + " ".join(re.findall(r"[a-z0-9\-]+", title.lower())) + " "
    insurer = UIN_PREFIX.get(code[:3]) if code else None
    if insurer is None:
        insurer = next((k for a, k in _ALIAS if f" {a} " in low), None)
    if insurer is None and code:
        insurer = f"uin:{code[:3]}"  # unknown prefix: still comparable with other UINs
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
    if a.insurer and a.insurer == b.insurer and a.name and b.name and not (a.name <= b.name or b.name <= a.name):
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
        for d in todo:
            out[d] = _cache[(d, titles[d])] = identify(titles[d], uins[d])
    return out


def related(prods: dict[str, Product], doc_a: str, doc_b: str) -> bool:
    """Can a difference between these two documents be a conflict? (same document, same product, or unknown)"""
    if doc_a == doc_b:
        return True
    pa, pb = prods.get(doc_a), prods.get(doc_b)
    return pa is None or pb is None or same_product(pa, pb)
