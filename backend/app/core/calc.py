"""Calculations (bonus): the LLM only names cited operands; Python checks each operand against its quote,
does the arithmetic and shows the working. The LLM's own number is never trusted."""

from dataclasses import dataclass

from app.core.normalise import Value, extract_values, matches
from app.schemas import CalcSpec


@dataclass
class CalcResult:
    ok: bool
    formula: str
    inputs: dict
    steps: list[str]
    result: float | None
    unit: str
    operand_citations: list[str]
    error: str | None = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def _inr(x: float) -> str:
    return f"₹{x:,.2f}"


QUESTION = "Q"  # operand source: the user's own question ("for a sum insured of Rs. 3,00,000")


def _verified_operands(spec: CalcSpec, evidence: dict[str, str], question: str = "") -> tuple[list[tuple[Value, str]], str | None]:
    """Each operand must be found, as a value, in what it cites: an evidence quote, or the question ('Q'). The
    question can supply the user's own figures (their sum insured), never the rule: at least one operand must come
    from the documents."""
    out = []
    for op in spec.operands:
        quote = question if op.cite == QUESTION and question else evidence.get(op.cite)
        if quote is None:
            return [], f"operand '{op.name}' cites unknown evidence {op.cite}"
        vals = extract_values(op.value)
        ev_vals = extract_values(quote)
        hit = next((v for v in vals for ev in ev_vals if matches(v, ev)), None)
        if hit is None:
            where = "the question" if op.cite == QUESTION else "the cited quote"
            return [], f"operand '{op.name}' = '{op.value}' is not in {where}"
        out.append((hit, op.cite))
    if out and all(c == QUESTION for _, c in out):
        return [], "no operand comes from the documents"
    return out, None


def compute(spec: CalcSpec, evidence: dict[str, str], question: str = "") -> CalcResult:
    ops, err = _verified_operands(spec, evidence, question)
    cites = [c for _, c in ops]
    if err:
        return CalcResult(False, spec.formula, {}, [], None, "", cites, err)
    res = _compute(spec, ops, cites)
    given = [v for v, c in ops if c == QUESTION]
    if res.ok and given:  # say which figures are the user's own, not the documents'
        res.steps = res.steps + [f"from your question: {', '.join(_shown(v) for v in given)}"]
    return res


def _shown(v: Value) -> str:
    return _inr(float(v.value)) if v.type == "inr" else f"{v.value:g}%" if v.type == "pct" else f"{v.value} {v.type}"


def _compute(spec: CalcSpec, ops: list[tuple[Value, str]], cites: list[str]) -> CalcResult:

    def first(t: str) -> Value | None:
        return next((v for v, _ in ops if v.type == t), None)

    if spec.formula == "emi":
        p, r = first("inr"), first("pct")
        n = first("months") or first("years")
        if not (p and r and n):
            return CalcResult(False, "emi", {}, [], None, "INR", cites, "EMI needs principal (₹), annual rate (%) and tenure")
        months = float(n.value) * (12 if n.type == "years" else 1)
        P, R = float(p.value), float(r.value)
        i = R / 12 / 100
        emi = P * i * (1 + i) ** months / ((1 + i) ** months - 1) if i else P / months
        steps = [
            f"P = {_inr(P)}, annual rate = {R}%, n = {months:g} months",
            f"monthly rate r = {R}% / 12 = {i:.7f}",
            f"EMI = P·r·(1+r)^n / ((1+r)^n − 1) = {_inr(P)} × {i:.7f} × {(1 + i) ** months:.6f} / {(1 + i) ** months - 1:.6f}",
            f"EMI = {_inr(emi)} per month; total payable = {_inr(emi * months)}; total interest = {_inr(emi * months - P)}",
        ]
        return CalcResult(True, "EMI = P·r·(1+r)^n / ((1+r)^n − 1)", {"P": P, "annual_rate_pct": R, "n_months": months},
                          steps, round(emi, 2), "INR", cites)

    if spec.formula == "simple_interest":
        p, r, d = first("inr"), first("pct"), first("days")
        if not (p and r and d):
            return CalcResult(False, "simple_interest", {}, [], None, "INR", cites, "needs amount (₹), annual rate (%) and days")
        P, R, D = float(p.value), float(r.value), float(d.value)
        if r.period == "pm":
            R = R * 12
        val = P * R / 100 * D / 365
        steps = [f"amount = {_inr(P)}, rate = {R}% p.a., days = {D:g}", f"interest = {_inr(P)} × {R}% × {D:g}/365 = {_inr(val)}"]
        return CalcResult(True, "P × r × d / 365", {"P": P, "annual_rate_pct": R, "days": D}, steps, round(val, 2), "INR", cites)

    if spec.formula == "percent_of":
        b, pc = first("inr"), first("pct")
        if not (b and pc):
            return CalcResult(False, "percent_of", {}, [], None, "INR", cites, "needs a base amount (₹) and a percentage")
        B, PC = float(b.value), float(pc.value)
        val = B * PC / 100
        return CalcResult(True, "base × percent / 100", {"base": B, "percent": PC},
                          [f"{_inr(B)} × {PC}% = {_inr(val)}"], round(val, 2), "INR", cites)

    if spec.formula == "sum":
        vals = [float(v.value) for v, _ in ops if v.type == "inr"]
        if not vals:
            return CalcResult(False, "sum", {}, [], None, "INR", cites, "no amounts to add")
        total = sum(vals)
        return CalcResult(True, "sum of amounts", {"amounts": vals}, [" + ".join(_inr(v) for v in vals) + f" = {_inr(total)}"],
                          round(total, 2), "INR", cites)
    return CalcResult(False, spec.formula, {}, [], None, "", cites, "unsupported formula")
