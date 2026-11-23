"""End-to-end pipeline on a mini corpus with the fake LLM: chain A->B->C, as-of dates, blocking, abstention,
contradiction, EMI calculation, edit & resend, shares."""

import httpx
import pytest
from sqlalchemy import text

from app.db import Base, engine, init_db
from app.ingest.htmlpdf import html_to_pdf
from app.llm.gemini import set_llm
from app.main import app
from tests.fake_llm import FakeLLM

H = {"X-API-Key": "test-key"}

MASTER = """<h1>Master Policy on Retail Loans</h1><p>Circular No. SCB/RL/2025/01 dated 1 April 2025</p>
<h2>7. Prepayment</h2>
<p>7.2 The prepayment penalty on floating-rate home loans shall be 2% of the outstanding principal.</p>
<h2>8. Penal Charges</h2>
<p>8.1 Penal charges on an overdue instalment shall be 2% p.a. over the contracted rate.</p>"""
CIRC_B = """<h1>Circular on Prepayment Charges</h1><p>Circular No. SCB/RL/2025/14 dated 1 October 2025</p>
<p>2. In partial modification of para 7.2 of the Master Policy on Retail Loans shall be substituted with effect from
2025-11-01 to read: “The prepayment penalty on floating-rate home loans shall be 1% of the outstanding principal.”</p>"""
CIRC_C = """<h1>Circular on Prepayment Relief</h1><p>Circular No. SCB/RL/2026/03 dated 15 June 2026</p>
<p>3. Para 2 of Circular SCB/RL/2025/14 stands substituted with effect from 2026-07-01 to read: “The prepayment
penalty on floating-rate home loans for individual borrowers shall be Nil.”</p>"""
KFS = """<h1>Key Facts Statement Home Loan</h1><p>Statement dated 1 May 2026</p>
<p>1. Loan amount ₹30,00,000 at 9.50% p.a. floating for 240 months.</p>
<p>2. Penal charges on overdue amount shall be 24% p.a.</p>"""


@pytest.fixture
async def client():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    set_llm(FakeLLM())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=60) as c:
        for name, body in [("master.pdf", MASTER), ("b.pdf", CIRC_B), ("c.pdf", CIRC_C), ("kfs.pdf", KFS)]:
            r = await c.post("/api/documents", headers=H, files=[("files", (name, html_to_pdf(body), "application/pdf"))])
            assert r.json()[0]["status"] == "queued"
        yield c
    set_llm(None)
    await engine.dispose()


async def ask(c, chat_id, q, as_of=None):
    body = {"question": q, **({"as_of": as_of} if as_of else {})}
    r = await c.post(f"/api/chats/{chat_id}/messages?stream=false", headers=H, json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def test_pipeline(client):
    c = client
    lib = (await c.get("/api/documents", headers=H)).json()
    assert all(d["ingest_status"] == "indexed" for d in lib), lib

    ams = (await c.get("/api/amendments", headers=H)).json()
    assert len(ams) == 2 and all(a["status"] == "confirmed" for a in ams), ams
    master_id = next(d["id"] for d in lib if d["title"].startswith("Master"))
    assert all(a["root_key"] == f"{master_id}:7.2" for a in ams), ams  # C resolved through B to A 7.2

    chat = (await c.post("/api/chats", headers=H, json={})).json()["id"]

    # today (2026-11-23 or later): C applies -> Nil
    m = await ask(c, chat, "What is the prepayment penalty on a floating-rate home loan?", "2026-11-23")
    a = m["answer"]
    assert a["status"] in ("answered", "partial"), a
    assert "Nil" in a["claims"][0]["text"] and a["claims"][0]["verdict"] == "supported", a["claims"]
    assert a["amendment_chains"], a
    assert a["faithfulness"]["pct"] == 100.0
    steps = {st["id"]: st for st in a["trace"]}  # the "show work" trace: what was searched, read, checked
    assert {"search", "versions", "draft", "verify", "conflicts"} <= steps.keys(), list(steps)
    assert steps["search"]["sources"] and steps["verify"]["checks"][0]["verdict"] == "supported"
    assert all(isinstance(st["ms"], int) for st in a["trace"])

    # edit & resend with an older as-of date -> version 2 of turn 1, answer flips to 2%
    r = await c.put(f"/api/chats/{chat}/turns/1?stream=false", headers=H,
                    json={"question": "What is the prepayment penalty on a floating-rate home loan?", "as_of": "2025-10-15"})
    v2 = r.json()
    assert v2["version"] == 2 and "2%" in v2["answer"]["claims"][0]["text"], v2["answer"]["claims"]
    hist = (await c.get(f"/api/chats/{chat}", headers=H)).json()
    assert len(hist["turns"][0]["versions"]) == 2

    # between B and C -> 1%
    a = (await ask(c, chat, "What is the prepayment penalty on a floating-rate home loan?", "2026-01-10"))["answer"]
    assert "1%" in a["claims"][0]["text"], a["claims"]

    # wrong number gets blocked; faithfulness computed on the draft
    a = (await ask(c, chat, "prepayment penalty (wrong draft)", "2026-11-23"))["answer"]
    verdicts = [cl["verdict"] for cl in a["claims"]]
    assert "contradicted" in verdicts or "unsupported" in verdicts, a["claims"]
    assert a["faithfulness"]["total"] == 2 and a["faithfulness"]["blocked"] == 1
    assert a["status"] == "partial"

    # abstention with a specific message
    a = (await ask(c, chat, "What is the foreclosure charge on gold loans?"))["answer"]
    assert a["status"] == "abstained" and "gold loans" in a["abstention"]["message"], a

    # EMI from cited operands, computed in Python
    a = (await ask(c, chat, "What is the EMI for the home loan in the KFS?"))["answer"]
    calc = a["calculations"][0]
    assert calc["ok"] and abs(calc["result"] - 27965.0) < 5, calc

    # contradiction: Master 8.1 (2% p.a. over contracted rate) vs KFS (24% p.a.)
    a = (await ask(c, chat, "What penal charges apply on an overdue instalment?"))["answer"]
    alerts = (await c.get("/api/alerts", headers=H)).json()
    assert alerts and {alerts[0]["a"]["doc_title"][:3], alerts[0]["b"]["doc_title"][:3]} == {"Mas", "Key"}, alerts

    # share: read-only snapshot + html export, public route needs no API key
    sh = (await c.post(f"/api/chats/{chat}/shares", headers=H, json={"expires_days": 1})).json()
    snap = (await c.get(sh["path"])).json()
    assert snap["turns"] and snap["crops"]
    page = await c.get(sh["html_path"])
    assert page.status_code == 200 and "Faithfulness" in page.text
    await c.delete(f"/api/shares/{sh['token']}", headers=H)
    assert (await c.get(sh["path"])).status_code == 404

    # Hindi question -> English drafting, Hindi output with numbers preserved, quotes stay English
    a = (await ask(c, chat, "फ्लोटिंग रेट होम लोन पर प्रीपेमेंट पेनल्टी कितनी है?", "2026-11-23"))["answer"]
    assert a["lang"] == "hi" and a["claims"][0]["text_hi"].startswith("(hi)"), a["claims"]
    assert "Nil" in a["claims"][0]["citations"][0]["quote"]

    # camera: transcribe a photo, then check the clause against the corpus
    t = (await c.post("/api/camera/transcribe", headers=H, files={"image": ("p.png", b"PNG-fake", "image/png")})).json()
    chk = (await c.post("/api/camera/check-clause", headers=H, json={"text": t["text"]})).json()
    assert chk["found"] and chk["match"]["doc_title"].startswith("Key Facts") and chk["conflicts"], chk

    # disabling circular C reverts the answer to B's 1%
    c_id = next(d["id"] for d in lib if "Relief" in d["title"])
    await c.patch(f"/api/documents/{c_id}", headers=H, json={"active": False})
    a = (await ask(c, chat, "What is the prepayment penalty on a floating-rate home loan?", "2026-11-23"))["answer"]
    assert "1%" in a["claims"][0]["text"], a["claims"]


async def test_answer_is_not_held_back_by_the_conflict_check(client, monkeypatch):
    """The verified answer streams before a slow contradiction check; an update with its result follows and is saved."""
    import asyncio
    import json

    import app.core.answer as answer_mod

    real = answer_mod.confirm_pairs

    async def slow(pairs):
        await asyncio.sleep(1.0)  # longer than the fake draft + verify
        return await real(pairs)

    monkeypatch.setattr(answer_mod, "confirm_pairs", slow)
    c = client
    chat = (await c.post("/api/chats", headers=H, json={})).json()["id"]
    r = await c.post(f"/api/chats/{chat}/messages", headers=H,
                     json={"question": "What penal charges apply on an overdue instalment?", "as_of": "2026-11-23"})
    assert r.status_code == 200, r.text
    events = []
    for block in r.text.replace("\r\n", "\n").split("\n\n"):
        name = next((ln[6:].strip() for ln in block.split("\n") if ln.startswith("event:")), None)
        data = next((ln[5:].strip() for ln in block.split("\n") if ln.startswith("data:")), None)
        if name in ("answer", "answer_update"):
            events.append((name, json.loads(data)["answer"]))
    assert [n for n, _ in events] == ["answer", "answer_update"], [n for n, _ in events]
    first, final = events[0][1], events[1][1]
    assert first["conflicts_pending"] is True and final["conflicts_pending"] is False
    assert first["faithfulness"] == final["faithfulness"]  # a conflict flag never changes the score
    saved = (await c.get(f"/api/chats/{chat}", headers=H)).json()["turns"][-1]["versions"][-1]["answer"]
    assert saved["conflicts_pending"] is False  # the stored answer is the updated one


async def test_conflict_verdicts_are_reused_not_reasked(client, monkeypatch):
    """A pair the model has judged (at upload or by an earlier question) is never sent to it again; a failed model call
    records nothing, so that pair is asked next time instead of being taken as 'no conflict'."""
    from datetime import date

    from sqlalchemy import func, select

    import app.core.contradictions as cmod
    from app.core.normalise import Value
    from app.core.retrieve import retrieve
    from app.db import SessionLocal
    from app.models import PairCheck, Sentence

    async with SessionLocal() as s:
        assert await s.scalar(select(func.count()).select_from(PairCheck)) > 0  # the upload scans recorded their verdicts
        await s.execute(PairCheck.__table__.delete())  # start clean: as if nothing was judged yet
        await s.commit()

        r = await retrieve(s, "What penal charges apply on an overdue instalment?", date(2026, 11, 23))
        values = {row.id: [Value(v["type"], v["value"], v.get("period")) for v in row.values]
                  for row in (await s.execute(select(Sentence.id, Sentence.values)
                                              .where(Sentence.id.in_([e.sentence_id for e in r.evidence])))).all()}
        _, pairs = await cmod.plan_evidence_check(s, r.evidence, values)
        assert pairs, "the penal-charge clauses should be a candidate pair"

        assert await cmod.finish_evidence_check(s, [], pairs, None) == []  # model failed: nothing recorded
        assert (await cmod.plan_evidence_check(s, r.evidence, values))[1] == pairs

        # at most 6 new pairs per question: once they are settled the next candidates get their turn, until none is left
        rounds, again = 0, pairs
        while again and rounds < 5:
            await cmod.finish_evidence_check(s, [], again, await cmod.confirm_pairs(again))
            known, again = await cmod.plan_evidence_check(s, r.evidence, values)
            assert not {frozenset((x.sentence_id, y.sentence_id)) for _, x, y in again} &                 {frozenset((x.sentence_id, y.sentence_id)) for _, x, y in pairs}, "a judged pair came back"
            pairs, rounds = again or pairs, rounds + 1
        assert again == [], "judged pairs must not go to the model again"
        assert known, "the conflict itself is still reported, from the stored alert"
