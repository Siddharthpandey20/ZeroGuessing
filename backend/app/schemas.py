"""LLM structured-output schemas (plan C.3). Kept flat: no dict-typed fields (Gemini schema limits)."""

from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------- draft
class Operand(BaseModel):
    name: str = Field(description="operand name, e.g. principal, annual_rate, months, days, base, percent")
    cite: str = Field(description="evidence id the value comes from, e.g. e7")
    value: str = Field(description="the value exactly as written in that evidence, e.g. '9.50% p.a.'")


class CalcSpec(BaseModel):
    formula: Literal["emi", "simple_interest", "percent_of", "sum"]
    operands: list[Operand]


class DraftClaim(BaseModel):
    t: str = Field(description="one atomic factual sentence")
    cite: list[str] = Field(description="evidence ids that prove this sentence")
    kind: Literal["fact", "calc_result", "conflict_note"] = "fact"
    historical: bool = Field(False, description="true only if the sentence describes a past/superseded version on purpose")
    calc: CalcSpec | None = None


class Draft(BaseModel):
    answerable: bool
    claims: list[DraftClaim]
    missing: list[str] = Field(default_factory=list, description="information the question needs that the evidence lacks")


# ---------------------------------------------------------------- verification judge
class JudgeItem(BaseModel):
    idx: int
    label: Literal["entailed", "neutral", "contradicted"]
    reason: str


class JudgeOut(BaseModel):
    items: list[JudgeItem]


# ---------------------------------------------------------------- amendments
class AmendItem(BaseModel):
    source_clause_ref: str = Field(description="paragraph/clause number of the amending text in THIS document")
    target_doc_ref: str = Field(description="title or circular number of the document being amended")
    target_clause_ref: str = Field(description="clause/paragraph number being amended, digits only like 7.2 or 2")
    action: Literal["substitute", "insert", "delete", "withdraw_document"]
    new_text: str | None = Field(None, description="replacement/inserted text copied verbatim from the document")
    old_value: str | None = None
    new_value: str | None = None
    effective_date: str | None = Field(None, description="YYYY-MM-DD if stated")
    effective_rule: Literal["date", "immediate", "date_of_circular", "unstated"] = "unstated"
    evidence: str = Field(description="evidence id of the amending sentence")
    confidence: float = Field(ge=0, le=1)


class AmendOut(BaseModel):
    amendments: list[AmendItem]


# ---------------------------------------------------------------- contradictions
class ContraItem(BaseModel):
    idx: int
    same_subject: bool
    conflict: bool
    subject: str
    attribute: str
    value_a: str
    value_b: str
    conditions_a: str
    conditions_b: str
    kind: Literal["number", "date", "rule", "eligibility"]
    explanation: str


class ContraOut(BaseModel):
    items: list[ContraItem]


# ---------------------------------------------------------------- language
class Translation(BaseModel):
    items: list[str]


class QueryTranslation(BaseModel):
    english: str
