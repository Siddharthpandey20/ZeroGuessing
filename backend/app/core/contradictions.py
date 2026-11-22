"""Contradiction detection (plan Q6). Bounded candidate pairs -> one batched LLM confirmation.
Amendment-linked clauses are supersession, not contradiction, and are excluded."""

import logging
import re
from itertools import combinations

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.amendments import chain_keys, key
from app.core.normalise import Value, conflicts
from app.core.retrieve import Evidence
from app.llm.gemini import get_llm
from app.models import Chunk, Clause, Contradiction, Document, Sentence
from app.schemas import ContraOut

log = logging.getLogger(__name__)

POLARITY = re.compile(r"\b(not|no|shall not|cannot|only|excluded|exclusion|mandatory|optional|eligible|ineligible|"
                      r"covered|not covered|prohibited|permitted|waived)\b", re.IGNORECASE)
_WORD = re.compile(r"[a-z]{4,}")
_GENERIC = set("shall which with that this from such will have been under where there their other than upon"
               " bank borrower borrowers loan loans policy document clause paragraph".split())

SYSTEM = (
    "You check whether two clauses from banking/insurance documents conflict. A conflict means they state "
    "incompatible numbers, dates, rules or eligibility for the SAME subject under the SAME conditions. "
    "Different products, borrower types, rate types or conditions are NOT a conflict. An explicit amendment is NOT a conflict."
)


def _content(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _GENERIC}


def _overlap(a: str, b: str) -> float:
    x, y = _content(a), _content(b)
    return len(x & y) / max(1, min(len(x), len(y)))


def _vals(raw: list[dict]) -> list[Value]:
    return [Value(v["type"], v["value"], v.get("period")) for v in raw]


def candidate(a_text: str, a_vals: list[Value], a_head: str, b_text: str, b_vals: list[Value], b_head: str) -> str | None:
    """'number' | 'rule' | None. Cheap filter before any LLM call."""
    ov = _overlap(f"{a_head} {a_text}", f"{b_head} {b_text}")
    if any(conflicts(x, y) for x in a_vals for y in b_vals) and ov >= 0.25:
        return "number"
    if ov >= 0.45 and (POLARITY.search(a_text) or POLARITY.search(b_text)):
        return "rule"
    return None


async def _confirm(pairs: list[tuple[dict, dict]]) -> list:
    blocks = [
        f"[{i}] A: \"{a['text']}\" ({a['doc_title']}, {a['clause_ref']}, heading: {a['heading']})\n"
        f"    B: \"{b['text']}\" ({b['doc_title']}, {b['clause_ref']}, heading: {b['heading']})"
        for i, (a, b) in enumerate(pairs)
    ]
    res = await get_llm().generate_json(ContraOut, "Check each pair.\n\n" + "\n\n".join(blocks), SYSTEM)
    return res.items


async def _store(session: AsyncSession, a: dict, b: dict, it, source: str) -> Contradiction:
    sa, sb = sorted([a["sentence_id"], b["sentence_id"]])
    existing = (await session.execute(select(Contradiction).where(Contradiction.sentence_a == sa, Contradiction.sentence_b == sb))).scalar_one_or_none()
    if existing:
        return existing
    c = Contradiction(sentence_a=sa, sentence_b=sb, subject=it.subject, attribute=it.attribute,
                      value_a=it.value_a if sa == a["sentence_id"] else it.value_b,
                      value_b=it.value_b if sa == a["sentence_id"] else it.value_a,
                      kind=it.kind, scope="intra" if a["doc_id"] == b["doc_id"] else "cross", source=source,
                      explanation=it.explanation)
    session.add(c)
    await session.flush()
    return c


def _ev_dict(e: Evidence) -> dict:
    return {"sentence_id": e.sentence_id, "doc_id": e.doc_id, "doc_title": e.doc_title, "clause_ref": e.clause_ref,
            "heading": e.heading_path, "text": e.text}


async def check_evidence(session: AsyncSession, evidence: list[Evidence], values: dict[str, list[Value]],
                         max_pairs: int = 6) -> list[Contradiction]:
    """Query-time check over the retrieved evidence; also returns already-known alerts touching it."""
    links = await chain_keys(session)
    sids = [e.sentence_id for e in evidence]
    known = list((await session.execute(select(Contradiction).where(
        or_(Contradiction.sentence_a.in_(sids), Contradiction.sentence_b.in_(sids))))).scalars().all())
    known_pairs = {frozenset((c.sentence_a, c.sentence_b)) for c in known}
    pairs = []
    current = [e for e in evidence if e.status == "current"]
    for a, b in combinations(current, 2):
        if a.clause_id == b.clause_id or frozenset((a.sentence_id, b.sentence_id)) in known_pairs:
            continue
        if frozenset((key(a.doc_id, a.clause_ref), key(b.doc_id, b.clause_ref))) in links:
            continue
        kind = candidate(a.text, values.get(a.sentence_id, []), a.heading_path, b.text, values.get(b.sentence_id, []), b.heading_path)
        if kind:
            pairs.append((kind, a, b))
    pairs.sort(key=lambda p: p[0] != "number")
    pairs = pairs[:max_pairs]
    if not pairs:
        return known
    try:
        items = await _confirm([(_ev_dict(a), _ev_dict(b)) for _, a, b in pairs])
    except Exception as e:
        log.warning("contradiction confirm failed: %s", e)
        return known
    for it in items:
        if 0 <= it.idx < len(pairs) and it.conflict and it.same_subject:
            _, a, b = pairs[it.idx]
            known.append(await _store(session, _ev_dict(a), _ev_dict(b), it, "query"))
    await session.commit()
    return known


async def scan_document(session: AsyncSession, doc_id: str, k: int = 5, batch: int = 10) -> int:
    """Ingestion-time scan: each chunk of the new document vs its k nearest chunks (any active doc, incl. itself)."""
    links = await chain_keys(session)
    chunks = (await session.execute(select(Chunk).where(Chunk.document_id == doc_id, Chunk.embedding.is_not(None)))).scalars().all()
    cand: dict[frozenset, tuple[dict, dict]] = {}
    for ch in chunks:
        near = (await session.execute(
            select(Chunk).join(Document, Document.id == Chunk.document_id)
            .where(Document.active.is_(True), Chunk.id != ch.id, Chunk.embedding.is_not(None))
            .order_by(Chunk.embedding.cosine_distance(ch.embedding)).limit(k)
        )).scalars().all()
        mine = await _sentences(session, ch.sentence_ids)
        for other in near:
            if other.clause_id == ch.clause_id:
                continue
            theirs = await _sentences(session, other.sentence_ids)
            for a in mine:
                for b in theirs:
                    pk = frozenset((a["sentence_id"], b["sentence_id"]))
                    if pk in cand or frozenset((key(a["doc_id"], a["clause_ref"]), key(b["doc_id"], b["clause_ref"]))) in links:
                        continue
                    if candidate(a["text"], a["values"], a["heading"], b["text"], b["values"], b["heading"]):
                        cand[pk] = (a, b)
    pairs = list(cand.values())[:60]
    found = 0
    for i in range(0, len(pairs), batch):
        part = pairs[i:i + batch]
        try:
            items = await _confirm(part)
        except Exception as e:
            log.warning("scan confirm failed: %s", e)
            continue
        for it in items:
            if 0 <= it.idx < len(part) and it.conflict and it.same_subject:
                await _store(session, *part[it.idx], it, "scan")
                found += 1
    await session.commit()
    return found


async def _sentences(session: AsyncSession, ids: list[str]) -> list[dict]:
    rows = await session.execute(
        select(Sentence, Clause, Document).join(Clause, Clause.id == Sentence.clause_id)
        .join(Document, Document.id == Sentence.document_id).where(Sentence.id.in_(ids))
    )
    return [{"sentence_id": s.id, "doc_id": d.id, "doc_title": d.title, "clause_ref": c.clause_ref, "heading": c.heading_path,
             "text": s.text, "values": _vals(s.values)} for s, c, d in rows]


async def alert_view(session: AsyncSession, contras: list[Contradiction]) -> list[dict]:
    """Both quotes side by side, with document, page and bboxes."""
    out = []
    for c in contras:
        sides = []
        for sid in (c.sentence_a, c.sentence_b):
            row = (await session.execute(
                select(Sentence, Clause, Document).join(Clause, Clause.id == Sentence.clause_id)
                .join(Document, Document.id == Sentence.document_id).where(Sentence.id == sid)
            )).first()
            if row is None:
                break
            s, cl, d = row
            if not d.active:
                break
            sides.append({"sentence_id": s.id, "doc_id": d.id, "doc_title": d.title, "clause_ref": cl.clause_ref,
                          "page": s.page, "quote": s.text, "bboxes": s.bboxes})
        if len(sides) == 2:
            out.append({"id": c.id, "subject": c.subject, "attribute": c.attribute, "kind": c.kind, "scope": c.scope,
                        "source": c.source, "explanation": c.explanation, "a": {**sides[0], "value": c.value_a},
                        "b": {**sides[1], "value": c.value_b}, "created_at": c.created_at.isoformat()})
    return out
