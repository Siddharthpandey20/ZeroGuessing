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
from app.core.products import named_documents
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
                "clause_ref": self.clause_ref, "heading": self.heading_path, "page": self.page, "quote": self.text,
                "bboxes": self.bboxes,
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
    named: list[set[str]] = field(default_factory=list)  # documents the question names (one set per document/product)


def key_terms(q: str) -> list[str]:
    toks = re.findall(r"[\w₹%]+(?:\.[\w]+)*", q.lower())
    return [t for t in toks if t not in _STOP and len(t) > 1][:16]


_SUFFIXES = ("ies", "ing", "es", "ed", "s")


def stem(t: str) -> str:
    """Crude English suffix strip so "conclusions" finds "Conclusion" and "charges" finds "charged". The full-text
    index uses the 'simple' config (no stemming: Hindi and figures stay verbatim), so we stem the question side and
    prefix-match. Only plain Latin words of 4+ letters are touched; numbers, clause refs and Hindi pass through."""
    if not re.fullmatch(r"[a-z]{4,}", t):
        return t
    for suf in _SUFFIXES:
        if t.endswith(suf) and len(t) - len(suf) >= 4:
            return t[: -len(suf)]
    return t


def tsquery(terms: list[str]) -> str:
    """OR-query for to_tsquery('simple', ...): stemmed words prefix-match (conclusion:* hits conclusion/conclusions)."""
    out = []
    for t in terms:
        t = re.sub(r"[^\w.]", "", t)
        if t:
            out.append(f"{stem(t)}:*" if re.fullmatch(r"[a-z]{4,}", t) else t)
    return " | ".join(out)


def _scoped(q, doc_ids: list[str] | None):
    """Limit a chunk/document query to a chat's documents (None: every active document)."""
    return q if doc_ids is None else q.where(Document.id.in_(doc_ids))


async def _dense(session: AsyncSession, qvec: list[float], n: int, doc_ids: list[str] | None = None) -> list[tuple[str, float]]:
    dist = Chunk.embedding.cosine_distance(qvec)
    rows = await session.execute(_scoped(
        select(Chunk.id, (1 - dist).label("score"))
        .join(Document, Document.id == Chunk.document_id)
        .where(Document.active.is_(True), Chunk.embedding.is_not(None)), doc_ids)
        .order_by(dist).limit(n)
    )
    return [(r.id, float(r.score)) for r in rows]


async def _fts(session: AsyncSession, terms: list[str], n: int, doc_ids: list[str] | None = None) -> list[tuple[str, float]]:
    tsq = tsquery(terms)
    if not tsq:
        return []
    q = func.to_tsquery("simple", tsq)
    rank = func.ts_rank_cd(Chunk.tsv, q)
    rows = await session.execute(_scoped(
        select(Chunk.id, rank.label("r")).join(Document, Document.id == Chunk.document_id)
        .where(Document.active.is_(True), Chunk.tsv.op("@@")(q)), doc_ids).order_by(rank.desc()).limit(n)
    )
    return [(r.id, float(r.r)) for r in rows]


def rrf(*lists: list[tuple[str, float]], k: int = 60, weights: list[float] | None = None) -> list[str]:
    score: dict[str, float] = {}
    for n, lst in enumerate(lists):
        w = weights[n] if weights else 1.0
        for rank, (cid, _) in enumerate(lst):
            score[cid] = score.get(cid, 0) + w / (k + rank + 1)
    return sorted(score, key=score.get, reverse=True)


async def rare_terms(session: AsyncSession, terms: list[str], max_df: float, doc_ids: list[str] | None = None) -> list[str]:
    """Question words that appear in at most `max_df` of the searched chunks. In a library of similar documents
    (ten health policies) words like 'policy', 'days' or the insurer's name are in nearly every chunk and only add
    noise to the keyword ranking; clause numbers, amounts and specific terms are rare and stay."""
    terms = [t for t in terms if R_SAFE.sub("", t)]
    if not terms:
        return []
    base = _scoped(select(func.count()).select_from(Chunk).join(Document, Document.id == Chunk.document_id)
                   .where(Document.active.is_(True)), doc_ids)
    total = (await session.execute(base)).scalar_one()
    if not total:
        return terms
    cols = [func.count().filter(Chunk.tsv.op("@@")(func.to_tsquery("simple", tsquery([t])))) for t in terms]
    counts = (await session.execute(_scoped(select(*cols).select_from(Chunk).join(Document, Document.id == Chunk.document_id)
                                             .where(Document.active.is_(True)), doc_ids))).one()
    # floor of 3 chunks: in a tiny library every word is in >10% of chunks, and none of them is noise
    return [t for t, c in zip(terms, counts) if c <= max(3, max_df * total)]


R_SAFE = re.compile(r"[^\w.]")


async def retrieve(session: AsyncSession, question: str, as_of: date, search_text: str | None = None,
                   doc_ids: list[str] | None = None) -> RetrievalResult:
    """Hybrid search. `doc_ids` limits it, and the amendment resolution behind it, to one chat's documents."""
    s = get_settings()
    terms = key_terms(search_text or question)
    dense: list[tuple[str, float]] = []
    qvec = None
    try:
        qvec = await get_llm().embed_query(question)
        dense = await _dense(session, qvec, 50, doc_ids)
    except Exception as e:  # keyword search still answers if embeddings are unavailable
        log.warning("dense retrieval unavailable: %s", e)
    # keyword search on the informative words only, and with less say than meaning-based search (measured on the
    # 127-question insurance set: Hit@1 52% -> 76%, Hit@5 87% -> 99%; demo set unchanged or better)
    fts = await _fts(session, await rare_terms(session, terms, s.fts_max_df, doc_ids), 50, doc_ids)
    ranked = rrf(dense, fts, k=s.rrf_k, weights=[1.0, s.fts_weight])[: s.retrieve_k]
    named = await named_documents(session, search_text or question, doc_ids)
    if len(named) > 1 and qvec is not None:
        # a question about several named documents: each one's best chunks go first, taking turns, so one document's
        # clauses cannot use up the evidence budget and leave the comparison with one side missing
        per = [[cid for cid, _ in await _dense(session, qvec, RESERVE, list(g))] for g in named]
        reserved: list[str] = []
        for i in range(RESERVE):
            for lst in per:
                if i < len(lst) and lst[i] not in reserved:
                    reserved.append(lst[i])
        ranked = reserved + [c for c in ranked if c not in reserved]
    docs_searched = (await session.execute(_scoped(select(func.count()).select_from(Document).where(Document.active.is_(True)), doc_ids))).scalar_one()

    chunks = {c.id: c for c in (await session.execute(select(Chunk).where(Chunk.id.in_(ranked)))).scalars()} if ranked else {}
    sent_ids = await _budget(session, [chunks[c] for c in ranked if c in chunks], terms, s.max_evidence)
    ev = await _load_evidence(session, sent_ids)

    statuses = await statuses_for(session, [(e.doc_id, e.clause_ref) for e in ev], as_of, doc_ids)
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
        extra_st = await statuses_for(session, [(x.doc_id, x.clause_ref) for x in extra], as_of, doc_ids)
        for x in extra:
            st = extra_st.get(key(x.doc_id, x.clause_ref))
            if st and st.state != "current":
                x.status, x.status_note = st.state, st.note
        ev.extend(extra)
        statuses.update(extra_st)
    for i, e in enumerate(ev):
        e.eid = f"e{i + 1}"
    return RetrievalResult(ev, statuses, dense[0][1] if dense else None, len(fts), terms, docs_searched, named=named)


PER_CHUNK = 6
RESERVE = 3  # chunks kept for each named document in a multi-document question


async def clause_neighbours(session: AsyncSession, ev: list[Evidence]) -> dict[str, list[Evidence]]:
    """For each evidence sentence, the sentences right before and after it in the same clause (never table rows:
    the next row of a table is a different item, and its value must not prove this one)."""
    ev = [e for e in ev if not e.is_table_row]
    if not ev:
        return {}
    pos = {r.id: (r.clause_id, r.ord) for r in (await session.execute(
        select(Sentence.id, Sentence.clause_id, Sentence.ord).where(Sentence.id.in_([e.sentence_id for e in ev])))).all()}
    want = {(c, o + d) for c, o in pos.values() for d in (-1, 1)}
    rows = (await session.execute(select(Sentence.id, Sentence.clause_id, Sentence.ord, Sentence.is_table_row)
                                  .where(Sentence.clause_id.in_({c for c, _ in want})))).all()
    at = {(r.clause_id, r.ord): r.id for r in rows if not r.is_table_row and (r.clause_id, r.ord) in want}
    loaded = {x.sentence_id: x for x in await _load_evidence(session, list(set(at.values())))}
    out: dict[str, list[Evidence]] = {}
    for e in ev:
        if e.sentence_id not in pos:
            continue
        c, o = pos[e.sentence_id]
        xs = [loaded[at[(c, o + d)]] for d in (-1, 1) if (c, o + d) in at and at[(c, o + d)] in loaded]
        for x in xs:  # same clause: same status on the as-of date
            x.status, x.status_note = e.status, e.status_note
        out[e.sentence_id] = xs
    return out


async def _budget(session: AsyncSession, ranked: list[Chunk], terms: list[str], limit: int) -> list[str]:
    """Spread the evidence budget across the ranked chunks instead of letting one long chunk (a 25-row fee table)
    swallow it. Pass 1: each chunk gives its PER_CHUNK sentences that best match the question terms (kept in
    document order). Pass 2: any budget left goes to the remaining sentences, still in chunk rank order."""
    all_ids = [sid for ch in ranked for sid in ch.sentence_ids]
    if not all_ids:
        return []
    text = {sid: t.lower() for sid, t in (await session.execute(select(Sentence.id, Sentence.text).where(Sentence.id.in_(all_ids)))).all()}
    terms = [stem(t) for t in terms]  # "conclusions" must score the sentence that says "Conclusion"
    out: list[str] = []
    seen: set[str] = set()

    def take(sid: str) -> bool:
        if sid in seen or sid not in text:
            return len(out) < limit
        seen.add(sid)
        out.append(sid)
        return len(out) < limit

    for ch in ranked:
        ids = list(ch.sentence_ids)
        if len(ids) > PER_CHUNK:
            score = {sid: sum(t in text.get(sid, "") for t in terms) for sid in ids}
            best = set(sorted(ids, key=lambda sid: (-score[sid], ids.index(sid)))[:PER_CHUNK])
            ids = [sid for sid in ids if sid in best]
        for sid in ids:
            if not take(sid):
                return out
    for ch in ranked:
        for sid in ch.sentence_ids:
            if not take(sid):
                return out
    return out


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
