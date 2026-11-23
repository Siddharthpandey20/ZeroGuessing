"""Contradiction detection (plan Q6). Bounded candidate pairs -> one batched LLM confirmation.
Amendment-linked clauses are supersession, not contradiction, and are excluded."""

import asyncio
import logging
import re
from itertools import combinations

from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.amendments import chain_keys, key
from app.core.normalise import Value, conflicts
from app.core.retrieve import Evidence
from app.llm.gemini import get_llm
from app.models import Chunk, Clause, Contradiction, Document, PairCheck, Sentence
from app.schemas import ContraOut

log = logging.getLogger(__name__)

POLARITY = re.compile(r"\b(not|no|shall not|cannot|only|excluded|exclusion|mandatory|optional|eligible|ineligible|"
                      r"covered|not covered|prohibited|permitted|waived)\b", re.IGNORECASE)
# narrower than POLARITY: a statement that denies, excludes or restricts (used to pair "X is covered" with "X is not covered")
NEGATED = re.compile(r"\b(not|no|never|cannot|only|excluded|exclusion|ineligible|prohibited)\b", re.IGNORECASE)
_WORD = re.compile(r"[a-z]{4,}")
_GENERIC = set("shall which with that this from such will have been under where there their other than upon"
               " bank borrower borrowers loan loans policy document clause paragraph".split())

SYSTEM = (
    "You check whether two clauses from banking/insurance documents conflict. A conflict means they state "
    "incompatible numbers, dates, rules or eligibility for the SAME subject under the SAME conditions. "
    "Different products, borrower types, rate types or conditions are NOT a conflict. An explicit amendment is NOT a conflict."
)


SCAN_PARALLEL = 3  # model calls in flight at once during an upload's scan (kept low for API rate limits)


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


async def _already_checked(session: AsyncSession, pairs: list[tuple[str, str]]) -> set[frozenset]:
    """The pairs (by sentence id) the model has judged before, whatever it said."""
    if not pairs:
        return set()
    ids = {i for p in pairs for i in p}
    rows = (await session.execute(select(PairCheck.sentence_a, PairCheck.sentence_b)
                                  .where(PairCheck.sentence_a.in_(ids), PairCheck.sentence_b.in_(ids)))).all()
    return {frozenset(r) for r in rows}


async def _record(session: AsyncSession, part: list[tuple[dict, dict]], items: list) -> None:
    """Remember each verdict the model actually returned. A failed or missing verdict is not recorded: that pair is
    asked again next time rather than silently treated as 'no conflict'."""
    rows = {}
    for it in items:
        if 0 <= it.idx < len(part):
            sa, sb = sorted([part[it.idx][0]["sentence_id"], part[it.idx][1]["sentence_id"]])
            rows[(sa, sb)] = {"sentence_a": sa, "sentence_b": sb, "conflict": bool(it.conflict and it.same_subject)}
    if rows:
        await session.execute(insert(PairCheck).values(list(rows.values())).on_conflict_do_nothing())


def _ev_dict(e: Evidence) -> dict:
    return {"sentence_id": e.sentence_id, "doc_id": e.doc_id, "doc_title": e.doc_title, "clause_ref": e.clause_ref,
            "heading": e.heading_path, "text": e.text}


async def check_evidence(session: AsyncSession, evidence: list[Evidence], values: dict[str, list[Value]],
                         max_pairs: int = 6, doc_ids: list[str] | None = None) -> list[Contradiction]:
    """Query-time check over the retrieved evidence; also returns already-known alerts touching it.
    With `doc_ids` (a chat's documents), a known alert counts only if both of its sentences are in that scope."""
    known, pairs = await plan_evidence_check(session, evidence, values, max_pairs, doc_ids)
    return await finish_evidence_check(session, known, pairs, await confirm_pairs(pairs))


async def confirm_pairs(pairs: list) -> list | None:
    """The model call of the query-time check, on its own: it never touches the DB session, so the answer pipeline
    runs it while the draft and the verifier run (it is a third of the answer's time otherwise). None: no verdict."""
    if not pairs:
        return []
    try:
        return await _confirm([(_ev_dict(a), _ev_dict(b)) for _, a, b in pairs])
    except Exception as e:
        log.warning("contradiction confirm failed: %s", e)
        return None


async def finish_evidence_check(session: AsyncSession, known: list[Contradiction], pairs: list, items: list | None) -> list[Contradiction]:
    if not pairs or items is None:
        return known
    await _record(session, [(_ev_dict(a), _ev_dict(b)) for _, a, b in pairs], items)
    for it in items:
        if 0 <= it.idx < len(pairs) and it.conflict and it.same_subject:
            _, a, b = pairs[it.idx]
            known.append(await _store(session, _ev_dict(a), _ev_dict(b), it, "query"))
    await session.commit()
    return known


async def plan_evidence_check(session: AsyncSession, evidence: list[Evidence], values: dict[str, list[Value]],
                              max_pairs: int = 6, doc_ids: list[str] | None = None) -> tuple[list[Contradiction], list]:
    """DB part of the query-time check: the known alerts touching the evidence, and the candidate pairs to confirm."""
    links = await chain_keys(session, doc_ids)
    sids = [e.sentence_id for e in evidence]
    known = list((await session.execute(select(Contradiction).where(
        or_(Contradiction.sentence_a.in_(sids), Contradiction.sentence_b.in_(sids))))).scalars().all())
    if doc_ids is not None and known:
        other = {s for c in known for s in (c.sentence_a, c.sentence_b)}
        doc_of = dict((await session.execute(select(Sentence.id, Sentence.document_id).where(Sentence.id.in_(other)))).all())
        scope = set(doc_ids)
        known = [c for c in known if doc_of.get(c.sentence_a) in scope and doc_of.get(c.sentence_b) in scope]
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
    # pairs the upload scan (or an earlier question) already judged are settled: a conflict among them is in `known`,
    # the rest were judged consistent. Only never-seen pairs go to the model, so usually there is no model call at all.
    seen = await _already_checked(session, [(a.sentence_id, b.sentence_id) for _, a, b in pairs])
    pairs = [p for p in pairs if frozenset((p[1].sentence_id, p[2].sentence_id)) not in seen]
    pairs.sort(key=lambda p: p[0] != "number")
    return known, pairs[:max_pairs]


async def scan_document(session: AsyncSession, doc_id: str, k: int = 12, batch: int = 10) -> int:
    """Ingestion-time scan of one document against the library. Candidates come from two sources:
    (1) each chunk's k nearest chunks by embedding, and (2) a direct pass pairing this document's sentences with any
    sentence elsewhere whose numbers conflict on overlapping wording, because embeddings of title-prefixed chunks
    cluster by document and can miss the clause that actually disagrees. Title blocks (_preamble) are skipped."""
    # alerts whose sentences were replaced by a re-ingest can never be shown again: drop them
    live = select(Sentence.id)
    await session.execute(delete(Contradiction).where(or_(Contradiction.sentence_a.not_in(live), Contradiction.sentence_b.not_in(live))))
    links = await chain_keys(session)
    cand: dict[frozenset, tuple[str, float, dict, dict]] = {}

    def consider(a: dict, b: dict) -> None:
        if a["sentence_id"] == b["sentence_id"] or a["clause_ref"].startswith("_") or b["clause_ref"].startswith("_"):
            return
        if a["doc_id"] == b["doc_id"] and a["clause_ref"] == b["clause_ref"]:
            return
        pk = frozenset((a["sentence_id"], b["sentence_id"]))
        if pk in cand or frozenset((key(a["doc_id"], a["clause_ref"]), key(b["doc_id"], b["clause_ref"]))) in links:
            return
        kind = candidate(a["text"], a["values"], a["heading"], b["text"], b["values"], b["heading"])
        if kind:
            cand[pk] = (kind, _overlap(f"{a['heading']} {a['text']}", f"{b['heading']} {b['text']}"), a, b)

    chunks = (await session.execute(select(Chunk).where(Chunk.document_id == doc_id, Chunk.embedding.is_not(None)))).scalars().all()
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
            for a in mine:
                for b in await _sentences(session, other.sentence_ids):
                    consider(a, b)

    # direct pass over sentences that carry values (a few hundred at corpus scale)
    rows = (await session.execute(
        select(Sentence, Clause, Document).join(Clause, Clause.id == Sentence.clause_id)
        .join(Document, Document.id == Sentence.document_id).where(Document.active.is_(True))
    )).all()
    every = [{"sentence_id": s.id, "doc_id": d.id, "doc_title": d.title, "clause_ref": c.clause_ref, "heading": c.heading_path,
              "text": s.text, "values": _vals(s.values)} for s, c, d in rows]
    valued = [v for v in every if v["values"]]
    for a in (v for v in valued if v["doc_id"] == doc_id):
        for b in valued:
            consider(a, b)

    # rule / eligibility conflicts carry no numbers and share few words ("co-borrowers ... are covered" vs
    # "co-borrowers are not covered"): pair sentences across documents that share a distinctive term (in <= 4
    # sentences library-wide) where exactly one side is negated or restricted. The LLM still confirms each pair.
    df: dict[str, int] = {}
    toks = {v["sentence_id"]: _content(v["text"]) for v in every}
    for t in toks.values():
        for w in t:
            df[w] = df.get(w, 0) + 1
    rule_pairs = 0
    for a in (v for v in every if v["doc_id"] == doc_id and not v["clause_ref"].startswith("_")):
        rare = {w for w in toks[a["sentence_id"]] if df.get(w, 0) <= 4 and len(w) > 3}
        if not rare:
            continue
        for b in every:
            if b["doc_id"] == doc_id or rule_pairs >= 15:
                continue
            if not (rare & toks[b["sentence_id"]]) or bool(NEGATED.search(a["text"])) == bool(NEGATED.search(b["text"])):
                continue
            pk = frozenset((a["sentence_id"], b["sentence_id"]))
            if pk in cand or b["clause_ref"].startswith("_"):
                continue
            if frozenset((key(a["doc_id"], a["clause_ref"]), key(b["doc_id"], b["clause_ref"]))) in links:
                continue
            cand[pk] = ("rule", _overlap(f"{a['heading']} {a['text']}", f"{b['heading']} {b['text']}"), a, b)
            rule_pairs += 1

    seen = await _already_checked(session, [tuple(pk) for pk in cand])
    ranked = sorted((v for pk, v in cand.items() if pk not in seen), key=lambda t: (t[0] != "number", -t[1]))
    pairs = [(a, b) for _, _, a, b in ranked[:60]]
    parts = [pairs[i:i + batch] for i in range(0, len(pairs), batch)]
    gate = asyncio.Semaphore(SCAN_PARALLEL)

    async def ask(part: list[tuple[dict, dict]]) -> list | None:
        async with gate:
            try:
                return await _confirm(part)
            except Exception as e:
                log.warning("scan confirm failed: %s", e)
                return None

    # the batches are independent model calls: run them together (the DB writes stay sequential on this session)
    found = 0
    for part, items in zip(parts, await asyncio.gather(*(ask(p) for p in parts))):
        if items is None:
            continue
        await _record(session, part, items)
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
