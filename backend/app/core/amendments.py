"""Amendment chains (plan Q7): detect -> extract (LLM) -> link to root clause -> resolve status as of a date.

Keys: '<doc_id>:<clause_ref>'. target_key = what the amendment directly names; root_key = the original clause
it ultimately changes (C amends B ¶2, which amended A 7.2  ->  C.root_key = A:7.2, C.via = B's amendment).
"""

import logging
import re
from dataclasses import dataclass, field
from datetime import date

from rapidfuzz import fuzz
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.llm.gemini import get_llm
from app.models import Amendment, Clause, Document, Sentence
from app.schemas import AmendOut

log = logging.getLogger(__name__)

TRIGGER = re.compile(
    r"in partial modification of|hereby substituted|shall be substituted|stands? substituted|substituted (?:by|with)"
    r"|shall be inserted|is (?:hereby )?inserted|shall be (?:deleted|omitted)|stands? (?:deleted|omitted|withdrawn|repealed)"
    r"|is hereby (?:withdrawn|repealed)|supersed(?:es|ed)|shall be read as|amended as (?:follows|under)",
    re.IGNORECASE,
)
_REF_CLEAN = re.compile(r"^(?:para(?:graph)?|clause|section|sub-?para(?:graph)?|¶|no\.?)\s*", re.IGNORECASE)

SYSTEM = (
    "You extract amendment instructions from regulatory circulars and policy documents. "
    "Only report amendments that the given text explicitly states. Copy new_text verbatim from the evidence; "
    "never paraphrase. Use the target document's title or circular number as written. If a date is not stated, use null."
)


def clean_ref(ref: str) -> str:
    ref = _REF_CLEAN.sub("", ref.strip()).strip(" .:")
    return ref.replace(" ", "")


def key(doc_id: str, ref: str) -> str:
    return f"{doc_id}:{clean_ref(ref)}"


async def _match_doc(session: AsyncSession, ref: str, exclude: str) -> Document | None:
    docs = (await session.execute(select(Document).where(Document.id != exclude))).scalars().all()
    best, score = None, 0.0
    for d in docs:
        cands = [d.title or "", d.circular_no or "", d.filename]
        s = max(fuzz.token_set_ratio(ref.lower(), c.lower()) for c in cands if c)
        if d.circular_no and d.circular_no.lower() in ref.lower():
            s = 100
        if s > score:
            best, score = d, s
    return best if score >= 70 else None


async def extract_for_document(session: AsyncSession, doc: Document) -> list[Amendment]:
    """Find trigger sentences, ask the LLM for structured amendments, store as proposed/confirmed."""
    # re-ingest replaces the document's sentences: drop amendments extracted from the old ones (manual entries,
    # which have no source sentence, are kept) so stale rows can't feed the chain resolver
    await session.execute(delete(Amendment).where(
        Amendment.source_doc_id == doc.id, Amendment.source_sentence_id.is_not(None),
        Amendment.source_sentence_id.not_in(select(Sentence.id).where(Sentence.document_id == doc.id))))
    rows = (
        await session.execute(
            select(Sentence, Clause.clause_ref).join(Clause, Clause.id == Sentence.clause_id)
            .where(Sentence.document_id == doc.id).order_by(Clause.ord, Sentence.ord)
        )
    ).all()
    idx = [i for i, (s, _) in enumerate(rows) if TRIGGER.search(s.text)]
    if not idx:
        return []
    keep = sorted({j for i in idx for j in (i - 1, i, i + 1, i + 2) if 0 <= j < len(rows)})
    ev = {f"e{n + 1}": rows[j] for n, j in enumerate(keep)}
    others = (await session.execute(select(Document).where(Document.id != doc.id))).scalars().all()
    known = "\n".join(f"- {d.title} (circular no: {d.circular_no or 'n/a'}, issued {d.issue_date or 'n/a'})" for d in others)
    evidence = "\n".join(f"[{eid}] (clause {ref}) {s.text}" for eid, (s, ref) in ev.items())
    prompt = (
        f"THIS DOCUMENT: {doc.title} (circular no: {doc.circular_no or 'n/a'}, issued {doc.issue_date or 'n/a'})\n"
        f"KNOWN OTHER DOCUMENTS:\n{known or '- none'}\n\nEVIDENCE:\n{evidence}\n\n"
        "List every amendment this document makes to another document."
    )
    out = await get_llm().generate_json(AmendOut, prompt, SYSTEM)

    s = get_settings()
    created = []
    for a in out.amendments:
        src = ev.get(a.evidence)
        if src is None:
            continue
        sentence, src_ref = src
        target = await _match_doc(session, a.target_doc_ref, doc.id)
        # zero-guessing on amendments too: new_text must really be in the source clause
        clause_text = (await session.get(Clause, sentence.clause_id)).text
        new_text = a.new_text
        if new_text and fuzz.partial_ratio(new_text.lower(), clause_text.lower()) < 90:
            new_text = clause_text  # fall back to the verbatim clause
        eff = None
        if a.effective_date:
            try:
                eff = date.fromisoformat(a.effective_date)
            except ValueError:
                eff = None
        if eff is None and a.effective_rule in ("immediate", "date_of_circular", "unstated"):
            eff = doc.issue_date
        resolved = target is not None and a.confidence >= s.amend_autoconfirm
        am = Amendment(
            source_doc_id=doc.id, source_sentence_id=sentence.id, source_clause_ref=clean_ref(a.source_clause_ref or src_ref),
            target_doc_id=target.id if target else None, target_doc_ref=a.target_doc_ref,
            target_clause_ref=clean_ref(a.target_clause_ref), action=a.action, new_text=new_text,
            old_value=a.old_value, new_value=a.new_value, issue_date=doc.issue_date, effective_date=eff,
            trigger_phrase=(TRIGGER.search(sentence.text) or [None])[0], confidence=a.confidence,
            status="confirmed" if resolved else "proposed",
        )
        session.add(am)
        created.append(am)
    await session.flush()
    await relink(session)
    return created


async def relink(session: AsyncSession) -> None:
    """Recompute target_key/root_key/via for all amendments (order-independent: works whatever upload order)."""
    ams = (await session.execute(select(Amendment))).scalars().all()
    for a in ams:
        a.target_key = key(a.target_doc_id, a.target_clause_ref) if a.target_doc_id else None
    by_source = {key(a.source_doc_id, a.source_clause_ref): a for a in ams if a.source_clause_ref}
    for a in ams:
        root, via, seen = a.target_key, None, set()
        while root and root in by_source and root not in seen:  # target is itself an amending paragraph
            seen.add(root)
            parent = by_source[root]
            via = via or parent.id
            root = parent.target_key
        a.root_key, a.via_amendment_id = root, via
    await session.flush()


# ---------------------------------------------------------------- resolution
@dataclass
class ClauseStatus:
    key: str
    state: str  # current | superseded | not_yet_effective | deleted | withdrawn
    current_text: str | None
    current_source: dict | None  # {amendment_id, doc_id, clause_ref, sentence_id, effective_date}
    history: list[dict] = field(default_factory=list)
    pending: list[dict] = field(default_factory=list)

    @property
    def note(self) -> str:
        if self.state == "current":
            return "CURRENT"
        src = self.current_source or {}
        return f"{self.state.upper().replace('_', ' ')}" + (
            f" by {src.get('doc_title', '')} ¶{src.get('clause_ref', '')} w.e.f. {src.get('effective_date')}" if src else ""
        )


def _eff(a: Amendment) -> date:
    return a.effective_date or a.issue_date or date.min


async def _confirmed(session: AsyncSession, doc_ids: list[str] | None = None) -> list[Amendment]:
    """Confirmed amendments from active documents; with `doc_ids`, only those issued by a document in that scope
    (a chat's own documents: a circular that is not in the chat does not change the rule for that chat)."""
    q = (
        select(Amendment).join(Document, Document.id == Amendment.source_doc_id)
        .where(Amendment.status == "confirmed", Document.active.is_(True))
    )
    if doc_ids is not None:
        q = q.where(Amendment.source_doc_id.in_(doc_ids))
    return list((await session.execute(q)).scalars().all())


async def clause_status(session: AsyncSession, doc_id: str, clause_ref: str, as_of: date,
                        _cache: list[Amendment] | None = None) -> ClauseStatus:
    k = key(doc_id, clause_ref)
    ams = _cache if _cache is not None else await _confirmed(session)
    titles = {d.id: d.title for d in (await session.execute(select(Document))).scalars().all()}

    def ev(a: Amendment, state: str) -> dict:
        return {"amendment_id": a.id, "doc_id": a.source_doc_id, "doc_title": titles.get(a.source_doc_id, ""),
                "clause_ref": a.source_clause_ref, "sentence_id": a.source_sentence_id, "action": a.action,
                "effective_date": _eff(a).isoformat() if _eff(a) != date.min else None, "new_text": a.new_text, "state": state}

    withdrawn = [a for a in ams if a.action == "withdraw_document" and a.target_doc_id == doc_id and _eff(a) <= as_of]
    # direct changes to this clause, or (if this is a root clause) everything in its chain
    events = sorted([a for a in ams if a.target_key == k or a.root_key == k], key=lambda a: (_eff(a), a.issue_date or date.min))
    st = ClauseStatus(k, "current", None, None)
    applied: Amendment | None = None
    for a in events:
        if _eff(a) > as_of:
            st.pending.append(ev(a, "not_yet_effective"))
            continue
        applied = a
        st.history.append(ev(a, "applied"))
    if withdrawn:
        st.state, st.current_source = "withdrawn", ev(withdrawn[-1], "applied")
        return st
    if applied:
        st.state = "deleted" if applied.action == "delete" else "superseded"
        st.current_source = ev(applied, "applied")
        st.current_text = None if applied.action == "delete" else applied.new_text
        for h in st.history[:-1]:
            h["state"] = "superseded"
        st.history[-1]["state"] = "current"
        return st
    # an amending paragraph whose change has not started yet is not the rule in force either
    own = [a for a in ams if a.source_clause_ref and key(a.source_doc_id, a.source_clause_ref) == k]
    if own and all(_eff(a) > as_of for a in own):
        st.state, st.current_source = "not_yet_effective", ev(own[0], "not_yet_effective")
    return st


async def statuses_for(session: AsyncSession, refs: list[tuple[str, str]], as_of: date,
                       doc_ids: list[str] | None = None) -> dict[str, ClauseStatus]:
    cache = await _confirmed(session, doc_ids)
    out = {}
    for doc_id, ref in set(refs):
        out[key(doc_id, ref)] = await clause_status(session, doc_id, ref, as_of, cache)
    return out


async def chain_keys(session: AsyncSession, doc_ids: list[str] | None = None) -> set[frozenset[str]]:
    """Pairs of clause keys linked by an amendment (excluded from contradiction alerts)."""
    links = set()
    for a in await _confirmed(session, doc_ids):
        src = key(a.source_doc_id, a.source_clause_ref or "")
        for t in (a.target_key, a.root_key):
            if t:
                links.add(frozenset((src, t)))
        if a.target_key and a.root_key:
            links.add(frozenset((a.target_key, a.root_key)))
    return links
