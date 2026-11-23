"""The draft's evidence block writes each document title once per run of lines and the status only when it is not
CURRENT. It must stay lossless (every line's id, document, clause/table row, page, status and text recoverable) and
keep retrieval order, which is relevance order."""

import re

from app.core.answer import EVIDENCE_HEADER, _evidence_block
from app.core.retrieve import Evidence, RetrievalResult


def _ev(eid, doc, ref, text, *, status="current", note="CURRENT", table=False, page=1) -> Evidence:
    return Evidence(eid=eid, sentence_id=eid, doc_id=doc, doc_title=f"Title {doc}", clause_id="c", clause_ref=ref,
                    heading_path="", page=page, text=text, bboxes=[], is_table_row=table, status=status, status_note=note)


def _parse(block: str) -> list[tuple]:
    out, doc = [], None
    for ln in block.split("\n"):
        if ln.startswith("## "):
            doc = ln[3:]
            continue
        m = re.fullmatch(r"\[(\w+)\] \((table row|clause [^|]*?) \| p\.(\d+)(?: \| (.*?))?\) (.*)", ln)
        out.append((m[1], doc, m[2], int(m[3]), m[4] or "CURRENT", m[5]))
    return out


def test_block_is_lossless_and_keeps_relevance_order():
    ev = [
        _ev("e1", "A", "5.4", "LTV is 80%."),
        _ev("e2", "A", "7.2", "Penalty 2%.", status="superseded", note="SUPERSEDED by Circular X ¶3 w.e.f. 2026-07-01"),
        _ev("e3", "B", "", "Row: fee | 1%", table=True, page=4),
        _ev("e4", "A", "6.1", "Floating rate."),  # back to A: order is kept, A gets a new heading
    ]
    block = _evidence_block(RetrievalResult(ev, {}, None, 0, [], 0))
    want = [(e.eid, e.doc_title, "table row" if e.is_table_row else f"clause {e.clause_ref}", e.page,
             e.status_note if e.status != "current" else "CURRENT", e.text) for e in ev]
    assert _parse(block) == want
    assert block.count("## Title A") == 2 and block.count("## Title B") == 1
    assert "CURRENT" not in block  # implied by the header line instead
    assert "no status is CURRENT" in EVIDENCE_HEADER
