"""Calculations: every operand is checked against what it cites; the user's own figure may come from the question."""

from app.core.calc import compute
from app.schemas import CalcSpec, Operand

EV = {"e1": "Room rent is payable up to 1% of the sum insured per day."}
Q = "What is the maximum room rent per day for a sum insured of Rs. 3,00,000?"


def spec(*ops):
    return CalcSpec(formula="percent_of", operands=[Operand(name=n, cite=c, value=v) for n, c, v in ops])


def test_operand_from_the_question():
    r = compute(spec(("base", "Q", "Rs. 3,00,000"), ("percent", "e1", "1%")), EV, Q)
    assert r.ok and r.result == 3000
    assert r.operand_citations == ["Q", "e1"]
    assert r.steps[-1] == "from your question: ₹300,000.00"


def test_question_value_must_really_be_in_the_question():
    r = compute(spec(("base", "Q", "Rs. 5,00,000"), ("percent", "e1", "1%")), EV, Q)
    assert not r.ok and "not in the question" in r.error


def test_the_rule_must_come_from_the_documents():
    r = compute(spec(("base", "Q", "Rs. 3,00,000"), ("percent", "Q", "1%")), EV, Q + " at 1%")
    assert not r.ok and r.error == "no operand comes from the documents"


def test_without_a_question_Q_is_unknown():
    r = compute(spec(("base", "Q", "Rs. 3,00,000"), ("percent", "e1", "1%")), EV)
    assert not r.ok and "unknown evidence" in r.error
