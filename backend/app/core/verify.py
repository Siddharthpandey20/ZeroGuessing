"""Per-claim verification (plan Q5, Gemini variant). Deterministic checks first; they can block on their own:
 (a) every cited id exists in the evidence shown to the drafter
 (b) every number/date/amount in the claim appears in the cited quotes (conflicting value -> contradicted)
 (d) cited clause is in force on the as-of date (unless the claim is explicitly historical)
then (c) one batched strict-judge LLM call for entailment of the claims that survived.
Faithfulness = claims backed by a matching quote / all DRAFT claims (before blocking)."""

import logging
from dataclasses import dataclass, field

from app.core.calc import compute
from app.core.normalise import check_claim_values, extract_values
from app.core.retrieve import Evidence
from app.llm.gemini import get_llm
from app.schemas import Draft, JudgeOut

log = logging.getLogger(__name__)

JUDGE_SYSTEM = (
    "You are a strict verifier for a legal/financial document assistant. For each claim decide whether the quoted "
    "evidence ALONE proves it. 'entailed' only if every part of the claim is stated or directly implied by the quotes. "
    "'contradicted' if the quotes state something incompatible. Otherwise 'neutral'. Do not use outside knowledge. "
    "Different conditions or scope (e.g. fixed vs floating rate, individual vs business) mean NOT entailed."
)


@dataclass
class VerifiedClaim:
    text: str
    verdict: str  # supported | unsupported | contradicted | conflicted
    reason: str | None
    citations: list[dict]
    kind: str = "fact"
    judge: str | None = None
    calculation: dict | None = None
    conflict_ids: list[str] = field(default_factory=list)
    text_hi: str | None = None

    def to_dict(self) -> dict:
        return {"text": self.text, "verdict": self.verdict, "reason": self.reason, "citations": self.citations,
                "kind": self.kind, "judge": self.judge, "calculation": self.calculation, "conflict_ids": self.conflict_ids,
                "text_hi": self.text_hi}


async def verify(draft: Draft, evidence: list[Evidence], as_of_iso: str) -> list[VerifiedClaim]:
    by_eid = {e.eid: e for e in evidence}
    quotes = {e.eid: e.text for e in evidence}
    out: list[VerifiedClaim] = []
    to_judge: list[int] = []

    for c in draft.claims:
        ev = [by_eid[i] for i in c.cite if i in by_eid]
        cites = [e.citation() for e in ev]
        if not ev:
            out.append(VerifiedClaim(c.t, "unsupported", "no valid citation: the cited evidence does not exist", [], c.kind))
            continue

        if c.kind == "calc_result" and c.calc:
            r = compute(c.calc, quotes)
            op_ev = [by_eid[i] for i in r.operand_citations if i in by_eid]
            stale = [e for e in op_ev if e.status != "current"]
            if not r.ok:
                out.append(VerifiedClaim(c.t, "unsupported", f"calculation blocked: {r.error}", cites, c.kind, calculation=r.to_dict()))
            elif stale:
                out.append(VerifiedClaim(c.t, "contradicted", f"operand from a clause that is {stale[0].status_note}",
                                         [e.citation() for e in op_ev], c.kind, calculation=r.to_dict()))
            else:
                text = f"{c.t.rstrip('.')} — computed: ₹{r.result:,.2f}." if r.result is not None else c.t
                out.append(VerifiedClaim(text, "supported", None, [e.citation() for e in op_ev], c.kind, calculation=r.to_dict()))
            continue

        # (b) values; ignore the as-of date the system itself injected
        missing, conflicting = check_claim_values(c.t, [e.text for e in ev], ignore=[as_of_iso])
        if conflicting:
            out.append(VerifiedClaim(c.t, "contradicted",
                                     f"value(s) {', '.join(_fmt(v) for v in conflicting)} differ from the cited text", cites, c.kind))
            continue
        if missing:
            out.append(VerifiedClaim(c.t, "unsupported",
                                     f"value(s) {', '.join(_fmt(v) for v in missing)} not found in the cited text", cites, c.kind))
            continue
        # (d) supersession
        stale = [e for e in ev if e.status != "current"]
        if stale and not c.historical and len(stale) == len(ev):
            out.append(VerifiedClaim(c.t, "contradicted", f"cites {stale[0].doc_title} {stale[0].clause_ref}, which is {stale[0].status_note}",
                                     cites, c.kind))
            continue
        out.append(VerifiedClaim(c.t, "pending", None, cites, c.kind))
        to_judge.append(len(out) - 1)

    if to_judge:
        await _judge(out, to_judge, draft, by_eid)
    return out


async def _judge(out: list[VerifiedClaim], idxs: list[int], draft: Draft, by_eid: dict[str, Evidence]) -> None:
    blocks = []
    for n, i in enumerate(idxs):
        claim = out[i]
        q = "\n".join(f'  - "{c["quote"]}" ({c["doc_title"]}, {c["clause_ref"]}, p.{c["page"]})' for c in claim.citations)
        blocks.append(f"[{n}] CLAIM: {claim.text}\n  QUOTES:\n{q}")
    prompt = "Judge each claim.\n\n" + "\n\n".join(blocks)
    try:
        res = await get_llm().generate_json(JudgeOut, prompt, JUDGE_SYSTEM)
        labels = {it.idx: it for it in res.items}
    except Exception as e:
        log.warning("judge failed: %s", e)
        labels = {}
    for n, i in enumerate(idxs):
        it = labels.get(n)
        c = out[i]
        if it is None:
            c.verdict, c.reason = "unsupported", "verifier unavailable; claim not shown without verification"
        elif it.label == "entailed":
            c.verdict, c.judge = "supported", it.reason
        elif it.label == "contradicted":
            c.verdict, c.reason, c.judge = "contradicted", f"the cited text contradicts this: {it.reason}", it.reason
        else:
            c.verdict, c.reason, c.judge = "unsupported", f"the cited text does not prove this: {it.reason}", it.reason


def _fmt(v) -> str:
    unit = {"pct": "%", "inr": " INR", "days": " days", "months": " months", "years": " years"}.get(v.type, "")
    return f"{v.value}{unit}" if v.type != "date" else str(v.value)


def faithfulness(claims: list[VerifiedClaim]) -> dict:
    total = len(claims)
    backed = sum(1 for c in claims if c.verdict in ("supported", "conflicted"))
    return {"supported": backed, "total": total, "pct": round(100 * backed / total, 1) if total else 0.0,
            "blocked": sum(1 for c in claims if c.verdict in ("unsupported", "contradicted"))}


def has_values(text: str) -> bool:
    return bool(extract_values(text))
