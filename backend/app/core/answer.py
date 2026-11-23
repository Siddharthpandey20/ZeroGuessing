"""Question -> verified AnswerObject (plan C.1 query pipeline). Yields progress events for SSE."""

import hashlib
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.amendments import key
from app.core.contradictions import alert_view, check_evidence
from app.core.intent import chat_reply, classify, is_followup, overview, resolve_followup
from app.core.normalise import Value
from app.core.retrieve import RetrievalResult, retrieve
from app.core.verify import VerifiedClaim, faithfulness, verify
from app.llm.gemini import get_llm
from app.models import Amendment, AnswerCache, Contradiction, Document, Sentence
from app.schemas import Draft, QueryTranslation, Translation

log = logging.getLogger(__name__)
DEVANAGARI = re.compile(r"[ऀ-ॿ]")

DRAFT_SYSTEM = (
    "You answer questions about banking, insurance and regulatory documents using ONLY the numbered evidence. "
    "Rules: (1) Write one atomic factual sentence per claim. (2) Cite the evidence ids that prove each claim; cite only ids "
    "that appear in the evidence. (3) Never use outside knowledge and never guess. (4) Evidence tagged SUPERSEDED, DELETED or "
    "NOT YET EFFECTIVE is not the rule in force on the as-of date: answer with the CURRENT version, and mention the change only "
    "as a separate claim marked historical=true or as a not-yet-effective note. (5) If two current quotes disagree, write a "
    "kind=conflict_note claim citing both instead of choosing one. (6) For calculations, do not do arithmetic: emit one "
    "kind=calc_result claim with calc.formula and calc.operands (each operand cites the evidence id and copies the value exactly "
    "as written). (7) If the evidence does not contain what is asked, set answerable=false or leave it out, and list what is "
    "missing in 'missing'. (8) Keep numbers, amounts and dates exactly as written in the evidence."
)
TRANSLATE_SYSTEM = ("Translate each English sentence into natural Hindi. Keep every number, amount (₹), percentage, date "
                    "and clause/paragraph reference exactly as in the English. Return the same number of items in order.")


def _evidence_block(r: RetrievalResult) -> str:
    lines = []
    for e in r.evidence:
        tag = e.status_note if e.status != "current" else "CURRENT"
        kind = "table row" if e.is_table_row else f"clause {e.clause_ref}"
        lines.append(f"[{e.eid}] ({e.doc_title} | {kind} | p.{e.page} | {tag}) {e.text}")
    return "\n".join(lines)


async def corpus_version(session: AsyncSession) -> str:
    docs = (await session.execute(select(Document.id, Document.ingested_at, Document.active).order_by(Document.id))).all()
    am = (await session.execute(select(func.count(), func.max(Amendment.created_at)).where(Amendment.status == "confirmed"))).one()
    am_states = (await session.execute(select(Amendment.id, Amendment.status, Amendment.effective_date, Amendment.new_text).order_by(Amendment.id))).all()
    cc = (await session.execute(select(func.count()).select_from(Contradiction))).scalar_one()
    raw = json.dumps([[list(map(str, d)) for d in docs], list(map(str, am)), [list(map(str, a)) for a in am_states], cc])
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _digits(s: str) -> list[str]:
    s = s.translate(str.maketrans("०१२३४५६७८९", "0123456789"))
    return sorted(re.findall(r"\d+(?:[.,]\d+)*", s))


def _reply_answer(question: str, reply: str, as_of: date, t0: float) -> dict:
    """A conversational reply (greeting, thanks, help): no claims, so nothing to verify; the UI marks it as not from
    the documents."""
    return {"question": question, "question_en": None, "lang": "hi" if DEVANAGARI.search(question) else "en",
            "as_of": as_of.isoformat(), "status": "chat", "reply": reply, "searched": {"docs": 0, "terms": [], "evidence": 0},
            "claims": [], "faithfulness": faithfulness([]), "calculations": [], "contradictions": [], "amendment_chains": [],
            "abstention": None, "timings_ms": {"total": int((time.perf_counter() - t0) * 1000)}, "cached": False}


async def answer_question(session: AsyncSession, question: str, as_of: date, use_cache: bool = True,
                          doc_ids: list[str] | None = None, history: list[dict] | None = None) -> AsyncIterator[dict]:
    """The full pipeline. `doc_ids`: answer only from these documents (a chat's own); None searches every active one.
    `history`: earlier turns of the chat ({question, answer}), used to understand a follow-up question."""
    t0 = time.perf_counter()
    timings: dict[str, int] = {}
    # "show the work": every step the pipeline took, what it looked at and how long it took. Streamed as it happens
    # and kept with the answer. Structured data only; the web app words it (English or Hindi).
    trace: list[dict] = []

    def tick(name: str, since: float) -> float:
        now = time.perf_counter()
        timings[name] = int((now - since) * 1000)
        return now

    def step(sid: str, since: float, **data) -> dict:
        st = {"id": sid, "ms": int((time.perf_counter() - since) * 1000), **data}
        trace.append(st)
        return {"type": "trace", "step": st}

    s = get_settings()
    asked = question
    kind = classify(question)
    if kind in ("smalltalk", "help"):
        reply = chat_reply(question, kind, len(doc_ids) if doc_ids is not None else None)
        yield {"type": "answer", "answer": _reply_answer(question, reply, as_of, t0)}
        return
    if doc_ids is not None and not doc_ids:
        r = RetrievalResult([], {}, None, 0, [], 0)
        yield {"type": "answer", "answer": {
            "question": question, "question_en": None, "lang": "hi" if DEVANAGARI.search(question) else "en", "as_of": as_of.isoformat(),
            "searched": {"docs": 0, "terms": [], "evidence": 0},
            **_abstain(r, [], ["this chat has no documents yet: upload a PDF to the chat, then ask again"]),
            "timings_ms": {"total": int((time.perf_counter() - t0) * 1000)}}}
        return
    if kind == "overview":
        claims, n_docs = await overview(session, doc_ids)
        if not claims:
            reply = "Your documents are still being read. Ask again in a moment."
            yield {"type": "answer", "answer": _reply_answer(question, reply, as_of, t0)}
            return
        yield {"type": "answer", "answer": {
            "question": question, "question_en": None, "lang": "hi" if DEVANAGARI.search(question) else "en",
            "as_of": as_of.isoformat(), "status": "answered", "overview": True,
            "searched": {"docs": n_docs, "terms": [], "evidence": sum(len(c["citations"]) for c in claims)},
            "claims": claims, "faithfulness": {"supported": len(claims), "total": len(claims), "pct": 100.0, "blocked": 0},
            "calculations": [], "contradictions": [], "amendment_chains": [], "abstention": None,
            "timings_ms": {"total": int((time.perf_counter() - t0) * 1000)}, "cached": False}}
        return
    resolved = None
    if history and is_followup(question):
        t = time.perf_counter()
        resolved = await resolve_followup(question, history)
        question = resolved  # search, draft and verify against the standalone question; the user's words stay on screen
        if resolved != asked:
            yield step("understand", t, resolved=resolved, turns=len(history))
    scope = ",".join(sorted(doc_ids)) if doc_ids is not None else "*"
    cache_key = hashlib.sha256(f"{question.strip().lower()}|{as_of}|{scope}|{await corpus_version(session)}".encode()).hexdigest()
    if use_cache and s.answer_cache and (hit := await session.get(AnswerCache, cache_key)):
        # the same question on the same documents and date: the stored, already-verified answer, with its own trace
        yield {"type": "answer", "answer": {**hit.answer, "cached": True}}
        return

    lang = "hi" if DEVANAGARI.search(question) else "en"
    q_en = question
    if lang == "hi":
        yield {"type": "stage", "stage": "translating_question"}
        t = time.perf_counter()
        try:
            q_en = (await get_llm().generate_json(QueryTranslation, question,
                    "Translate this Hindi question into precise English. Keep numbers and terms.")).english
        except Exception as e:
            log.warning("query translation failed: %s", e)
        yield step("translate_question", t, english=q_en if q_en != question else None)

    yield {"type": "stage", "stage": "retrieving"}
    t = time.perf_counter()
    r = await retrieve(session, question, as_of, search_text=q_en, doc_ids=doc_ids)
    yield step("search", t, docs=r.docs_searched, terms=r.terms, passages=len(r.evidence),
               keyword_hits=r.fts_hits, best_score=round(r.best_dense, 3) if r.best_dense is not None else None,
               threshold=s.min_dense_score, sources=_sources(r))
    if versions := _version_notes(r):
        yield step("versions", t, as_of=as_of.isoformat(), clauses=versions)
        trace[-1]["ms"] = 0
    t = tick("retrieve", t)

    base = {"question": asked, "question_resolved": resolved, "question_en": q_en if lang == "hi" else None, "lang": lang, "as_of": as_of.isoformat(),
            "searched": {"docs": r.docs_searched, "terms": r.terms, "evidence": len(r.evidence)}}

    gate_fail = not r.evidence or (r.best_dense is not None and r.best_dense < s.min_dense_score and r.fts_hits == 0)
    if gate_fail:
        yield step("gate", t, passed=False, best_score=round(r.best_dense, 3) if r.best_dense is not None else None,
                   threshold=s.min_dense_score)
        ans = {**base, **_abstain(r, [], ["no passage in the loaded documents is related to this question"]),
               "timings_ms": {**timings, "total": int((time.perf_counter() - t0) * 1000)}, "trace": trace}
        yield {"type": "answer", "answer": ans}
        return

    yield {"type": "stage", "stage": "drafting", "evidence": len(r.evidence)}
    prompt = f"AS-OF DATE: {as_of.isoformat()}\nQUESTION: {q_en}\n\nEVIDENCE:\n{_evidence_block(r)}"
    try:
        draft = await get_llm().generate_json(Draft, prompt, DRAFT_SYSTEM)
    except Exception as e:
        log.exception("draft failed")
        yield {"type": "error", "message": f"answer generation failed: {e}"}
        return
    yield step("draft", t, claims=len(draft.claims), evidence=len(r.evidence), missing=list(draft.missing))
    t = tick("draft", t)

    yield {"type": "stage", "stage": "verifying", "claims": len(draft.claims)}
    claims = await verify(draft, r.evidence, as_of.isoformat())
    yield step("verify", t, checks=[{"text": c.text, "verdict": c.verdict, "reason": c.reason, "kind": c.kind,
                                      "quotes": len(c.citations), "judge": c.judge} for c in claims])
    t = tick("verify", t)

    yield {"type": "stage", "stage": "checking_contradictions"}
    values: dict[str, list[Value]] = {}
    for srow in (await session.execute(select(Sentence.id, Sentence.values).where(Sentence.id.in_([e.sentence_id for e in r.evidence])))).all():
        values[srow.id] = [Value(v["type"], v["value"], v.get("period")) for v in srow.values]
    contras = await check_evidence(session, r.evidence, values, doc_ids=doc_ids)
    cited = {c["sentence_id"] for vc in claims for c in vc.citations}
    relevant = [c for c in contras if c.sentence_a in cited or c.sentence_b in cited]
    for vc in claims:
        ids = {c["sentence_id"] for c in vc.citations}
        hits = [c.id for c in relevant if c.sentence_a in ids or c.sentence_b in ids]
        if hits and vc.verdict == "supported":
            vc.verdict, vc.conflict_ids = "conflicted", hits
            vc.reason = "the documents contain a conflicting clause on this point (shown side by side)"
    yield step("conflicts", t, pairs=len(contras), relevant=len(relevant))
    t = tick("contradictions", t)

    if lang == "hi":
        yield {"type": "stage", "stage": "translating_answer"}
        await _translate(claims)
        yield step("translate_answer", t, kept=sum(1 for c in claims if c.text_hi), total=len(claims))
        t = tick("translate", t)

    shown = [c for c in claims if c.verdict in ("supported", "conflicted")]
    blocked = [c for c in claims if c.verdict in ("unsupported", "contradicted")]
    if not shown:
        out = {**base, **_abstain(r, blocked, draft.missing)}
    else:
        status = "conflicted" if any(c.verdict == "conflicted" for c in shown) else ("partial" if blocked or draft.missing else "answered")
        out = {**base, "status": status, "abstention": None if not draft.missing else _missing_note(r, draft.missing)}
    out["claims"] = [c.to_dict() for c in claims]
    out["faithfulness"] = faithfulness(claims)
    out["calculations"] = [c.calculation for c in claims if c.calculation]
    out["contradictions"] = await alert_view(session, relevant)
    out["amendment_chains"] = _chains(r)
    out["timings_ms"] = {**timings, "total": int((time.perf_counter() - t0) * 1000)}
    out["trace"] = trace
    out["cached"] = False

    if s.answer_cache:
        await session.merge(AnswerCache(key=cache_key, answer=out))  # upsert: "run again" re-answers an already-cached key
        await session.commit()
    yield {"type": "answer", "answer": out}


def _sources(r: RetrievalResult, n: int = 8) -> list[dict]:
    """The distinct clauses the search read, best first (what the model was shown)."""
    out, seen = [], set()
    for e in r.evidence:
        k = (e.doc_id, e.clause_ref)
        if k in seen:
            continue
        seen.add(k)
        out.append({"doc_title": e.doc_title, "clause_ref": e.clause_ref, "page": e.page, "sentence_id": e.sentence_id,
                    "status": e.status, "added_for_amendment": e.injected})
        if len(out) == n:
            break
    return out


def _version_notes(r: RetrievalResult) -> list[dict]:
    """Clauses whose wording changed over time, and which version applies on the as-of date."""
    out = []
    for k, st in r.statuses.items():
        if st.history or st.pending:
            src = st.current_source or {}
            out.append({"key": k, "state": st.state, "changes": len(st.history), "pending": len(st.pending),
                        "by": src.get("doc_title"), "since": str(src.get("effective_date") or "") or None})
    return out


def _chains(r: RetrievalResult) -> list[dict]:
    chains, seen = [], set()
    by_sid = {e.sentence_id: e for e in r.evidence}
    for k, st in r.statuses.items():
        if not (st.history or st.pending) or k in seen:
            continue
        seen.add(k)
        root = next((e for e in r.evidence if key(e.doc_id, e.clause_ref) == k), None)
        events = []
        if root:
            events.append({"doc_title": root.doc_title, "clause_ref": root.clause_ref, "sentence_id": root.sentence_id,
                           "page": root.page, "text": root.text, "state": "superseded" if st.history else "current",
                           "effective_date": None})
        for h in st.history + st.pending:
            e = by_sid.get(h.get("sentence_id"))
            events.append({**h, "page": e.page if e else None, "quote": e.text if e else h.get("new_text")})
        chains.append({"key": k, "state": st.state, "events": events})
    return chains


def _missing_note(r: RetrievalResult, missing: list[str]) -> dict:
    closest = [e.citation() for e in r.evidence[:2]]
    covers = sorted({e.heading_path or e.clause_ref for e in r.evidence[:2]})
    return {"missing": missing, "closest": closest,
            "message": f"I don't have proof for: {'; '.join(missing)}. Searched {r.docs_searched} documents for "
                       f"'{' '.join(r.terms)}'. The closest passages ({', '.join(covers) or 'none'}) do not state it."}


def _abstain(r: RetrievalResult, blocked: list[VerifiedClaim], missing: list[str]) -> dict:
    reasons = list(missing) + [f"{c.text} ({c.reason})" for c in blocked]
    closest = [e.citation() for e in r.evidence[:2]]
    covers = sorted({f"{e.doc_title} {e.clause_ref}" for e in r.evidence[:2]})
    msg = (f"I don't have proof for this. Missing: {'; '.join(reasons) or 'a passage that answers the question'}. "
           f"Searched {r.docs_searched} documents for '{' '.join(r.terms)}'."
           + (f" Closest passages found: {', '.join(covers)}, which do not state it." if covers else ""))
    return {"status": "abstained", "abstention": {"missing": reasons, "closest": closest, "message": msg},
            "claims": [c.to_dict() for c in blocked], "faithfulness": faithfulness(blocked),
            "calculations": [], "contradictions": [], "amendment_chains": []}


async def _translate(claims: list[VerifiedClaim]) -> None:
    texts = [c.text for c in claims]
    if not texts:
        return
    try:
        res = await get_llm().generate_json(Translation, json.dumps(texts, ensure_ascii=False), TRANSLATE_SYSTEM)
    except Exception as e:
        log.warning("answer translation failed: %s", e)
        return
    for c, hi in zip(claims, res.items):
        # number guard: a translation that changes any number is dropped (English shown instead)
        c.text_hi = hi if _digits(hi) == _digits(c.text) else None
