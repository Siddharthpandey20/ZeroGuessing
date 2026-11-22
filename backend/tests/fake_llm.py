"""Deterministic stand-in for Gemini: behaves like a careful model so pipeline wiring can be tested offline."""

import hashlib
import re

import numpy as np

from app.schemas import (AmendItem, AmendOut, CalcSpec, ContraItem, ContraOut, Draft, DraftClaim, JudgeItem, JudgeOut,
                         Operand, QueryTranslation, Translation)

DIM = 768
EV = re.compile(r"^\[(e\d+)\] \((.*?)\) (.*)$", re.M)


def _vec(text: str) -> list[float]:
    v = np.zeros(DIM, dtype=np.float32)
    for w in re.findall(r"[a-z]{3,}", text.lower()):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % DIM] += 1
    n = np.linalg.norm(v)
    return (v / n if n else v + 1 / np.sqrt(DIM)).tolist()


class FakeLLM:
    def __init__(self):
        self.calls: list[str] = []

    async def embed(self, texts, task="RETRIEVAL_DOCUMENT"):
        return [_vec(t) for t in texts]

    async def embed_query(self, text):
        return _vec(text)

    async def read_image(self, data, mime):
        return "Penal charges on overdue amount shall be 24% p.a."

    async def generate_json(self, schema, prompt, system, *, temperature=0.0):
        self.calls.append(schema.__name__)
        return getattr(self, f"_{schema.__name__}")(prompt)

    # ---------------------------------------------------------------- amendments
    def _AmendOut(self, prompt):
        out = []
        this = re.search(r"THIS DOCUMENT: (.*?) \(", prompt).group(1)
        for eid, meta, text in EV.findall(prompt):
            if "substituted" not in text.lower():
                continue
            src = re.search(r"clause ([\w.()]+)", meta).group(1)
            m = re.search(r"para(?:graph)? ([\d.]+) of (?:the )?(.+?) (?:shall|stands)", text, re.I)
            eff = re.search(r"(\d{4}-\d{2}-\d{2})", text)
            new = re.search(r"[“\"](.+?)[”\"]", text)
            out.append(AmendItem(source_clause_ref=src, target_doc_ref=m.group(2), target_clause_ref=m.group(1),
                                 action="substitute", new_text=new.group(1) if new else None,
                                 effective_date=eff.group(1) if eff else None, effective_rule="date", evidence=eid,
                                 confidence=0.95))
        assert this
        return AmendOut(amendments=out)

    # ---------------------------------------------------------------- answering
    def _Draft(self, prompt):
        q = re.search(r"QUESTION: (.*)", prompt).group(1).lower()
        ev = EV.findall(prompt)

        def find(*words, current=True):
            for eid, meta, text in ev:
                if all(w in text.lower() for w in words) and (not current or "CURRENT" in meta):
                    return eid, text
            return None, None

        if "gold" in q:
            return Draft(answerable=False, claims=[], missing=["foreclosure charge for gold loans"])
        if "emi" in q:
            eid, text = find("loan amount")
            return Draft(answerable=True, claims=[DraftClaim(t="The monthly EMI for the home loan.", cite=[eid], kind="calc_result",
                         calc=CalcSpec(formula="emi", operands=[Operand(name="principal", cite=eid, value="₹30,00,000"),
                                                                 Operand(name="annual_rate", cite=eid, value="9.50%"),
                                                                 Operand(name="months", cite=eid, value="240 months")]))])
        if "prepayment" in q:
            eid, text = find("prepayment penalty")
            if eid is None:
                eid, text = find("prepayment")
            claims = [DraftClaim(t=f"Current rule: {text}", cite=[eid])]
            if "wrong" in q:
                claims.append(DraftClaim(t="The prepayment penalty is 5% of the outstanding principal.", cite=[eid]))
            return Draft(answerable=True, claims=claims)
        if "penal" in q:
            eid, text = find("penal")
            return Draft(answerable=True, claims=[DraftClaim(t=text, cite=[eid])])
        return Draft(answerable=False, claims=[], missing=["not in evidence"])

    def _JudgeOut(self, prompt):
        n = len(re.findall(r"^\[(\d+)\] CLAIM", prompt, re.M))
        return JudgeOut(items=[JudgeItem(idx=i, label="entailed", reason="stated in quote") for i in range(n)])

    def _ContraOut(self, prompt):
        items = []
        for i, a, b in re.findall(r"\[(\d+)\] A: \"(.*?)\".*?\n\s+B: \"(.*?)\"", prompt):
            both_penal = "penal" in a.lower() and "penal" in b.lower()
            items.append(ContraItem(idx=int(i), same_subject=both_penal, conflict=both_penal, subject="penal charges",
                                    attribute="rate", value_a="a", value_b="b", conditions_a="", conditions_b="",
                                    kind="number", explanation="different penal rates"))
        return ContraOut(items=items)

    def _Translation(self, prompt):
        import json
        return Translation(items=[f"(hi) {t}" for t in json.loads(prompt)])

    def _QueryTranslation(self, prompt):
        return QueryTranslation(english="What is the prepayment penalty?")
