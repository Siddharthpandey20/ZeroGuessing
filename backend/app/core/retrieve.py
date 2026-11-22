"""Hybrid retrieval (plan Q3/L.1): pgvector cosine + Postgres full-text, fused with RRF, then expanded into
sentence-level evidence with IDs (e1..eN), clause status tags and the current version of superseded clauses."""

import logging
import re
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.amendments import ClauseStatus, key, statuses_for
from app.llm.gemini import get_llm
from app.models import Chunk, Clause, Document, Sentence

log = logging.getLogger(__name__)

_STOP = set("""a an the of to in on for and or is are was were be by with as at from that this which what when where who
how does do did can may shall will would should could any all there their its it if not no than then into per under
about between within over i we you me my our your please tell explain much many""".split())


@dataclass
class Evidence:
    eid: str
    sentence_id: str
    doc_id: str
    doc_title: str
    clause_id: str
    clause_ref: str
    heading_path: str
    page: int
    text: str
    bboxes: list
    is_table_row: bool
    status: str = "current"
    status_note: str = "CURRENT"
    injected: bool = False  # added by amendment-aware expansion

    def citation(self) -> dict:
        return {"sentence_id": self.sentence_id, "doc_id": self.doc_id, "doc_title": self.doc_title,
                "clause_ref": self.clause_ref, "page": self.page, "quote": self.text, "bboxes": self.bboxes,
                "status": self.status, "status_note": self.status_note}


@dataclass
class RetrievalResult:
    evidence: list[Evidence]
    statuses: dict[str, ClauseStatus]
    best_dense: float | None
    fts_hits: int
    terms: list[str]
    docs_searched: int
    chain_events: list[dict] = field(default_factory=list)


def key_terms(q: str) -> list[str]:
    toks = re.findall(r"[\w₹%]+(?:\.[\w]+)*", q.lower())
    return [t for t in toks if t not in _STOP and len(t) > 1][:16]


async def _dense(session: AsyncSession, qvec: list[float], n: int) -> list[tuple[str, float]]:
    dist = Chunk.embedding.cosine_distance(qvec)
    rows = await session.execute(
        select(Chunk.id, (1 - dist).label("score"))
        .join(Document, Document.id == Chunk.document_id)
        .where(Document.active.is_(True), Chunk.embedding.is_not(None))
        .order_by(dist).limit(n)
    )
    return [(r.id, float(r.score)) for r in rows]


async def _fts(session: AsyncSession, terms: list[str], n: int) -> list[tuple[str, float]]:
    if not terms:
        return []
    tsq = " | ".join(re.sub(r"[^\w.]", "", t) for t in terms if re.sub(r"[^\w.]", "", t))
    if not tsq:
        return []
    q = func.to_tsquery("simple", tsq)
    rank = func.ts_rank_cd(Chunk.tsv, q)
    rows = await session.execute(
        select(Chunk.id, rank.label("r")).join(Document, Document.id == Chunk.document_id)
        .where(Document.active.is_(True), Chunk.tsv.op("@@")(q)).order_by(rank.desc()).limit(n)
    )
    return [(r.id, float(r.r)) for r in rows]


def rrf(*lists: list[tuple[str, float]], k: int = 60) -> list[str]:
    score: dict[str, float] = {}
    for lst in lists:
        for rank, (cid, _) in enumerate(lst):
            score[cid] = score.get(cid, 0) + 1 / (k + rank + 1)
    return sorted(score, key=score.get, reverse=True)


async def retrieve(session: AsyncSession, question: str, as_of: date, search_text: str | None = None) -> RetrievalResult:
    s = get_settings()
    terms = key_terms(search_text or question)
    dense: list[tuple[str, float]] = []
    try:
        qvec = await get_llm().embed_query(question)
        dense = await _dense(session, qvec, 50)
    except Exception as e:  # keyword search still answers if embeddings are unavailable
        log.warning("dense retrieval unavailable: %s", e)
    fts = await _fts(session, terms, 50)
    ranked = rrf(dense, fts, k=s.rrf_k)[: s.retrieve_k]
    docs_searched = (await session.execute(select(func.count()).select_from(Document).where(Document.active.is_(True)))).scalar_one()

    chunks = {c.id: c for c in (await session.execute(select(Chunk).where(Chunk.id.in_(ranked)))).scalars()} if ranked else {}
    sent_ids: list[str] = []
    for cid in ranked:
        for sid in chunks[cid].sentence_ids if cid in chunks else []:
            if sid not in sent_ids:
                sent_ids.append(sid)
    sent_ids = sent_ids[: s.max_evidence]
    ev = await _load_evidence(session, sent_ids)

    statuses = await statuses_for(session, [(e.doc_id, e.clause_ref) for e in ev], as_of)
    # amendment-aware expansion: make sure the version in force (and the amending text) is in front of the drafter
    inject: list[str] = []
    for e in ev:
        st = statuses.get(key(e.doc_id, e.clause_ref))
        if st and st.state != "current":
            e.status, e.status_note = st.state, st.note
        if st:
            for h in [*st.history, *st.pending]:
                if h.get("sentence_id") and h["sentence_id"] not in sent_ids and h["sentence_id"] not in inject:
                    inject.append(h["sentence_id"])
    if inject:
        extra = await _load_evidence(session, inject, injected=True)
        extra_st = await statuses_for(session, [(x.doc_id, x.clause_ref) for x in extra], as_of)
        for x in extra:
            st = extra_st.get(key(x.doc_id, x.clause_ref))
            if st and st.state != "current":
                x.status, x.status_note = st.state, st.note
        ev.extend(extra)
        statuses.update(extra_st)
    for i, e in enumerate(ev):
        e.eid = f"e{i + 1}"
    return RetrievalResult(ev, statuses, dense[0][1] if dense else None, len(fts), terms, docs_searched)


async def _load_evidence(session: AsyncSession, sent_ids: list[str], injected: bool = False) -> list[Evidence]:
    if not sent_ids:
        return []
    rows = await session.execute(
        select(Sentence, Clause, Document).join(Clause, Clause.id == Sentence.clause_id)
        .join(Document, Document.id == Sentence.document_id).where(Sentence.id.in_(sent_ids))
    )
    by_id = {s.id: (s, c, d) for s, c, d in rows}
    out = []
    for sid in sent_ids:
        if sid not in by_id:
            continue
        s, c, d = by_id[sid]
        out.append(Evidence("", s.id, d.id, d.title, c.id, c.clause_ref, c.heading_path, s.page, s.text, s.bboxes,
                            s.is_table_row, injected=injected))
    return out
