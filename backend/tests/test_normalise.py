import pytest

from app.core.normalise import Value, check_claim_values, conflicts, extract_values, matches


def vals(text):
    return [(v.type, v.value) for v in extract_values(text)]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("The penalty is 2%.", [("pct", 2.0)]),
        ("two per cent of the outstanding", [("pct", 2.0)]),
        ("2.0 percent", [("pct", 2.0)]),
        ("Rs. 5,000", [("inr", 5000.0)]),
        ("₹5000", [("inr", 5000.0)]),
        ("INR 5,000/-", [("inr", 5000.0)]),
        ("five thousand rupees", [("inr", 5000.0)]),
        ("Rs 1.5 lakh", [("inr", 150000.0)]),
        ("₹30,00,000", [("inr", 3000000.0)]),
        ("Rs. 2 crore", [("inr", 20000000.0)]),
        ("within 30 days", [("days", 30.0)]),
        ("within thirty (30) days", [("days", 30.0)]),
        ("one month", [("months", 1.0)]),
        ("240 months", [("months", 240.0)]),
        ("with effect from 1st July 2026", [("date", "2026-07-01")]),
        ("w.e.f. 01.07.2026", [("date", "2026-07-01")]),
        ("July 1, 2026", [("date", "2026-07-01")]),
        ("2027-01-01", [("date", "2027-01-01")]),
        ("Nil for individual borrowers", [("nil", 0.0)]),
    ],
)
def test_extract(text, expected):
    assert vals(text) == expected


def test_reference_stripping():
    assert vals("As per clause 7.2, the penalty is 1%.") == [("pct", 1.0)]
    assert vals("Circular SCB/RL/2025/14 sets the fee at ₹500") == [("inr", 500.0)]
    assert vals("See Annex 3 and para 8.1(b): 21 days") == [("days", 21.0)]
    assert vals("Circular No. 14 dated 1 October 2025") == [("date", "2025-10-01")]


def test_rate_period():
    v = extract_values("2% p.a. over the contracted rate")[0]
    assert v == Value("pct", 2.0, "pa")
    assert not matches(Value("pct", 2.0, "pa"), Value("pct", 2.0, "pm"))


def test_matching_and_conflicts():
    assert matches(Value("nil", 0.0), Value("pct", 0.0))
    assert conflicts(Value("days", 30.0), Value("days", 15.0))
    assert not conflicts(Value("days", 30.0), Value("months", 1.0))
    missing, conflicting = check_claim_values(
        "The grace period is 30 days.", ["Grace period: fifteen (15) days from the due date."]
    )
    assert missing == [Value("days", 30.0)] and conflicting == [Value("days", 30.0)]
    missing, _ = check_claim_values("The processing fee is capped at ₹25,000.", ["maximum Rs. 25,000/-"])
    assert missing == []
