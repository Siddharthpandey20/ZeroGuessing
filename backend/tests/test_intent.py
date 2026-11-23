"""Basic messages get sensible answers: small talk and help get a reply, "what is this document about" gets an
overview built from the documents, and a follow-up is read in the light of the previous turn."""

import pytest

from app.core.intent import classify, is_followup
from tests.test_chat_docs import client, pdf, sign_in  # noqa: F401  (fixture + helpers)
from tests.test_e2e import CIRC_B, KFS, MASTER


@pytest.mark.parametrize("q,kind", [
    ("hi", "smalltalk"), ("Hello!", "smalltalk"), ("thanks a lot", "smalltalk"), ("नमस्ते", "smalltalk"), ("ok", "smalltalk"),
    ("what can you do?", "help"), ("How does this work", "help"), ("help", "help"),
    ("What is this document about?", "overview"), ("summarize the pdf", "overview"), ("give me an overview", "overview"),
    ("what documents do I have", "overview"), ("What does this paper cover?", "overview"),
    # real questions must not be hijacked
    ("What is the EMI on the home loan in the key facts statement?", "question"),
    ("hi, what is the penal charge on an overdue instalment?", "question"),
    ("Summarize the prepayment rules for floating-rate loans", "question"),
])
def test_classify(q, kind):
    assert classify(q) == kind


@pytest.mark.parametrize("q,follow", [
    ("and for fixed rate?", True), ("what about gold loans", True), ("explain that", True), ("why?", True),
    ("is it the same for co-borrowers?", True),
    ("What is the prepayment penalty on a floating-rate home loan?", False),
    ("Within how many days must a complaint be resolved under the master policy?", False),
])
def test_is_followup(q, follow):
    assert is_followup(q) is follow


async def ask(c, chat_id, q):
    r = await c.post(f"/api/chats/{chat_id}/messages?stream=false", json={"question": q, "as_of": "2026-11-23"})
    assert r.status_code == 200, r.text
    return r.json()["answer"]


async def test_basic_messages_through_the_api(client):  # noqa: F811
    c = client
    await sign_in(c, "ana@bank.example")
    chat = (await c.post("/api/chats", json={})).json()["id"]

    a = await ask(c, chat, "hi")  # no documents yet: still a friendly reply, pointing at uploads
    assert a["status"] == "chat" and "no documents yet" in a["reply"] and a["claims"] == []

    await c.post(f"/api/chats/{chat}/documents", files=[pdf("master.pdf", MASTER), pdf("b.pdf", CIRC_B), pdf("kfs.pdf", KFS)])

    a = await ask(c, chat, "what can you do?")
    assert a["status"] == "chat" and "only with what they prove" in a["reply"] and "3 documents" in a["reply"]

    a = await ask(c, chat, "What is this document about?")
    assert a["status"] == "answered" and a.get("overview") is True and len(a["claims"]) == 3, a
    master = next(cl for cl in a["claims"] if cl["text"].startswith("Master Policy"))
    assert "Prepayment" in master["text"] and master["citations"] and master["verdict"] == "supported"
    assert all(cit["doc_title"].startswith("Master Policy") for cit in master["citations"])

    a = await ask(c, chat, "What is the prepayment penalty on a floating-rate home loan?")
    assert a["claims"] and not a.get("question_resolved")
    # follow-up: understood with the previous question (the fake model has no rewriter, so the fallback carries it)
    a = await ask(c, chat, "and why was it changed?")
    assert a["question"] == "and why was it changed?"
    assert a["question_resolved"] and "prepayment penalty" in a["question_resolved"].lower()
