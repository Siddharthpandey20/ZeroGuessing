"""Deterministic value extraction for claim verification (plan Q5).

extract_values("The penalty is two per cent p.a.") -> [Value(type='pct', value=2.0, period='pa')]
References (clause numbers, circular numbers) are stripped first so they never count as values.
"""

import re
from dataclasses import asdict, dataclass
from datetime import date

from dateutil import parser as dateparser


@dataclass(frozen=True)
class Value:
    type: str  # pct | inr | days | months | years | date | nil | num
    value: float | str  # float, or ISO date string for type=date
    period: str | None = None  # pa | pm (for rates)

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


# ---------------------------------------------------------------- references
_REF_PATTERNS = [
    r"\b(?:para(?:graph)?s?|clauses?|sections?|sub-?para(?:graph)?s?|sub-?clauses?|annex(?:ure)?s?|schedules?|articles?|rules?)\s*"
    r"(?:no\.?\s*)?[0-9ivxlc]+[A-Za-z]?(?:\.[0-9]+[A-Za-z]?)*(?:\s*\([a-z0-9]+\))*",
    r"¶\s*[0-9]+(?:\.[0-9]+)*",
    r"\b[A-Z]{2,}(?:/[A-Za-z0-9.-]+){2,}",  # SCB/RL/2025/14, DOR.STR.REC.12/21.06.001/2025-26
    r"\bno\.\s*[\w./-]*\d[\w./-]*",
]
_REF_RE = re.compile("|".join(_REF_PATTERNS), re.IGNORECASE)


def strip_references(text: str) -> str:
    return _REF_RE.sub(" ", text)


# ---------------------------------------------------------------- number words
_UNITS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
_SCALES = {"hundred": 100, "thousand": 1_000, "lakh": 100_000, "lakhs": 100_000, "crore": 10_000_000, "crores": 10_000_000}
_NUMWORD = "|".join(sorted([*_UNITS, *_TENS, *_SCALES], key=len, reverse=True))
_NUMWORD_SEQ = re.compile(rf"\b(?:{_NUMWORD})(?:[\s-]+(?:and[\s-]+)?(?:{_NUMWORD}))*\b", re.IGNORECASE)


def _words_to_int(words: str) -> int | None:
    total, current = 0, 0
    for w in re.split(r"[\s-]+", words.lower()):
        if w == "and" or not w:
            continue
        if w in _UNITS:
            current += _UNITS[w]
        elif w in _TENS:
            current += _TENS[w]
        elif w == "hundred":
            current = max(current, 1) * 100
        elif w in _SCALES:
            total += max(current, 1) * _SCALES[w]
            current = 0
        else:
            return None
    return total + current


def words_to_digits(text: str) -> str:
    # "thirty (30) days" -> "30 days" ; "two per cent" -> "2 per cent"
    def repl(m: re.Match) -> str:
        words = [w for w in re.split(r"[\s-]+", m.group(0).lower()) if w and w != "and"]
        if all(w in _SCALES for w in words):  # "1.5 lakh", "2 crore": scale follows digits, leave it
            return m.group(0)
        n = _words_to_int(m.group(0))
        return str(n) if n is not None else m.group(0)

    text = _NUMWORD_SEQ.sub(repl, text)
    text = re.sub(r"\b(\d+)\s*\(\s*\1\s*\)", r"\1", text)  # "30 (30)" -> "30"
    return text


# ---------------------------------------------------------------- patterns
_MONTHS = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_DATE_RE = re.compile(
    rf"\b\d{{1,2}}(?:st|nd|rd|th)?\s+{_MONTHS},?\s+\d{{4}}\b"  # 1st July 2026
    rf"|\b{_MONTHS}\s+\d{{1,2}}(?:st|nd|rd|th)?,?\s+\d{{4}}\b"  # July 1, 2026
    r"|\b\d{4}-\d{2}-\d{2}\b"  # 2026-07-01
    r"|\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b",  # 01.07.2026
    re.IGNORECASE,
)
_NUM = r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_INR_RE = re.compile(
    rf"(?:₹|\brs\.?|\binr)\s*({_NUM})\s*(lakhs?|crores?)?(?:\s*/-)?"
    rf"|\b({_NUM})\s*(lakhs?|crores?)?\s*(?:rupees|/-)",
    re.IGNORECASE,
)
_PERIOD = r"(?:\s*(p\.?\s?a\.?|per\s+annum|per\s+year|annually|p\.?\s?m\.?|per\s+month|monthly))?"
_PCT_RE = re.compile(rf"\b({_NUM})\s*(?:%|per\s*cent\b|percent\b){_PERIOD}", re.IGNORECASE)
_DUR_RE = re.compile(rf"\b({_NUM})\s*(days?|months?|years?)\b", re.IGNORECASE)
_NIL_RE = re.compile(r"\bnil\b", re.IGNORECASE)
_LEFTOVER_RE = re.compile(rf"\b({_NUM})\b")


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _period(s: str | None) -> str | None:
    if not s:
        return None
    s = s.lower().replace(" ", "").replace(".", "")
    return "pm" if s in ("pm", "permonth", "monthly") else "pa"


def _parse_date(s: str) -> str | None:
    s = s.strip()
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            return date.fromisoformat(s).isoformat()
        return dateparser.parse(s, dayfirst=True).date().isoformat()
    except (ValueError, OverflowError):
        return None


def extract_values(text: str, extra_ignore: list[str] | None = None) -> list[Value]:
    t = strip_references(text)
    for s in extra_ignore or []:
        t = t.replace(s, " ")
    t = words_to_digits(t)
    out: list[Value] = []

    def mask(m: re.Match) -> None:
        nonlocal t
        a, b = m.span()
        t = t[:a] + " " * (b - a) + t[b:]

    for m in list(_DATE_RE.finditer(t)):
        iso = _parse_date(m.group(0))
        if iso:
            out.append(Value("date", iso))
            mask(m)
    for m in list(_INR_RE.finditer(t)):
        amount, scale = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        v = _num(amount)
        if scale:
            v *= 100_000 if scale.lower().startswith("lakh") else 10_000_000
        out.append(Value("inr", v))
        mask(m)
    for m in list(_PCT_RE.finditer(t)):
        out.append(Value("pct", _num(m.group(1)), _period(m.group(2))))
        mask(m)
    for m in list(_DUR_RE.finditer(t)):
        unit = m.group(2).lower().rstrip("s") + "s"
        out.append(Value(unit, _num(m.group(1))))
        mask(m)
    for m in list(_NIL_RE.finditer(t)):
        out.append(Value("nil", 0.0))
        mask(m)
    for m in _LEFTOVER_RE.finditer(t):
        out.append(Value("num", _num(m.group(1))))
    return out


# ---------------------------------------------------------------- comparison
def _close(a: float, b: float) -> bool:
    return abs(a - b) <= 1e-6 * max(1.0, abs(a), abs(b))


def matches(claim_v: Value, ev_v: Value) -> bool:
    """Does an evidence value support a claim value?"""
    if claim_v.type == "nil" or ev_v.type == "nil":
        other = ev_v if claim_v.type == "nil" else claim_v
        return other.type == "nil" or (other.type != "date" and _close(float(other.value), 0.0))
    if claim_v.type == "num":  # bare number: any typed evidence value with the same magnitude
        return ev_v.type != "date" and _close(float(claim_v.value), float(ev_v.value))
    if claim_v.type != ev_v.type:
        return False
    if claim_v.type == "date":
        return claim_v.value == ev_v.value
    if claim_v.period and ev_v.period and claim_v.period != ev_v.period:
        return False
    return _close(float(claim_v.value), float(ev_v.value))


def conflicts(a: Value, b: Value) -> bool:
    """Same kind of quantity, different value (used by verifier + contradiction pairing)."""
    if a.type != b.type or a.type in ("num", "nil"):
        return False
    if a.period and b.period and a.period != b.period:
        return False
    return not matches(a, b)


def check_claim_values(claim: str, evidence_texts: list[str], ignore: list[str] | None = None) -> tuple[list[Value], list[Value]]:
    """Return (missing, conflicting) claim values against the union of evidence values."""
    ev_vals = [v for t in evidence_texts for v in extract_values(t)]
    missing, conflicting = [], []
    for cv in extract_values(claim, ignore):
        if any(matches(cv, ev) for ev in ev_vals):
            continue
        missing.append(cv)
        if any(conflicts(cv, ev) for ev in ev_vals):
            conflicting.append(cv)
    return missing, conflicting


def today() -> date:
    return date.today()
