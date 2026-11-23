"""Per-chat documents: a chat answers only from the PDFs uploaded to it (amendments included), uploads are open to
any signed-in user for their own chats, duplicates are linked not re-ingested, and chats get a short editable name."""

import httpx
import pytest
from sqlalchemy import text

from app.api.chats import short_title
from app.db import Base, engine, init_db
from app.ingest.htmlpdf import html_to_pdf
from app.llm.gemini import set_llm
from app.main import app
from tests.fake_llm import FakeLLM
from tests.test_e2e import CIRC_B, CIRC_C, KFS, MASTER

KEY = {"X-API-Key": "test-key"}
Q = "What is the prepayment penalty on a floating-rate home loan?"


@pytest.fixture
async def client():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    set_llm(FakeLLM())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t", timeout=60) as c:
        yield c
    set_llm(None)
    await engine.dispose()


_PDFS: dict[str, bytes] = {}


def pdf(name: str, body: str):
    """The same bytes every time for the same body (the renderer stamps a creation time), like re-uploading one file."""
    data = _PDFS.setdefault(body, html_to_pdf(body))
    return ("files", (name, data, "application/pdf"))


async def sign_in(c: httpx.AsyncClient, email: str) -> None:
    assert (await c.post("/api/users", headers=KEY, json={"email": email, "password": "secret-pass-1"})).status_code == 201
    c.cookies.clear()
    assert (await c.post("/api/auth/login", json={"email": email, "password": "secret-pass-1"})).status_code == 200


async def ask(c, chat_id, as_of="2026-11-23", q=Q):
    r = await c.post(f"/api/chats/{chat_id}/messages?stream=false", json={"question": q, "as_of": as_of})
    assert r.status_code == 200, r.text
    return r.json()["answer"]


async def test_chat_scoped_documents(client):
    c = client
    # the admin's own library upload must stay invisible to a viewer and out of the viewer's chats
    assert (await c.post("/api/documents", headers=KEY, files=[pdf("kfs.pdf", KFS)])).json()[0]["status"] == "queued"
    await sign_in(c, "ana@bank.example")  # a viewer: uploads into their own chats are allowed

    a = (await c.post("/api/chats", json={})).json()["id"]
    b = (await c.post("/api/chats", json={})).json()["id"]
    empty = (await c.post("/api/chats", json={})).json()["id"]

    r = await c.post(f"/api/chats/{a}/documents", files=[pdf("master.pdf", MASTER), pdf("b.pdf", CIRC_B), pdf("c.pdf", CIRC_C)])
    assert r.status_code == 202 and [x["status"] for x in r.json()] == ["queued"] * 3, r.text
    docs_a = (await c.get(f"/api/chats/{a}/documents")).json()
    assert len(docs_a) == 3 and all(d["ingest_status"] == "indexed" for d in docs_a), docs_a

    # same file into another chat: linked, not stored or ingested twice
    r = await c.post(f"/api/chats/{b}/documents", files=[pdf("master.pdf", MASTER)])
    assert r.json()[0]["status"] == "duplicate"
    assert [d["filename"] for d in (await c.get(f"/api/chats/{b}/documents")).json()] == ["master.pdf"]

    # chat A holds both circulars: the amendment chain applies -> Nil
    ans = await ask(c, a)
    assert "Nil" in ans["claims"][0]["text"] and ans["amendment_chains"], ans
    assert ans["searched"]["docs"] == 3
    # chat B holds only the master policy: no circular changes the rule there -> 2%
    ans = await ask(c, b)
    assert "2%" in ans["claims"][0]["text"] and not ans["amendment_chains"], ans
    assert ans["searched"]["docs"] == 1
    # a chat with no documents says so instead of searching anything else
    ans = await ask(c, empty)
    assert ans["status"] == "abstained" and "no documents" in ans["abstention"]["missing"][0], ans

    # short, editable names
    chats = {x["id"]: x["title"] for x in (await c.get("/api/chats")).json()}
    assert chats[a] == short_title(Q) and len(chats[a]) < len(Q)
    r = await c.patch(f"/api/chats/{a}", json={"title": "  Loan   rules "})
    assert r.status_code == 200 and r.json()["title"] == "Loan rules"
    assert (await c.patch(f"/api/chats/{a}", json={"title": ""})).status_code == 422

    # a viewer's alerts cover their own documents only (none of their pairs conflict; the admin sees everything)
    assert all({x["a"]["doc_title"], x["b"]["doc_title"]} <= {d["title"] for d in docs_a} for x in (await c.get("/api/alerts")).json())

    # a viewer's document list is their own chats' documents only (not the admin's KFS)
    assert sorted(d["filename"] for d in (await c.get("/api/documents")).json()) == ["b.pdf", "c.pdf", "master.pdf"]

    # unlink from a chat; the file stays for chat A
    assert (await c.delete(f"/api/chats/{b}/documents/{docs_a[0]['id']}")).status_code == 204
    assert (await c.get(f"/api/chats/{b}/documents")).json() == []
    assert len((await c.get(f"/api/chats/{a}/documents")).json()) == 3

    # another user cannot see or upload into ana's chat
    await sign_in(c, "bob@bank.example")
    assert (await c.get(f"/api/chats/{a}/documents")).status_code == 404
    assert (await c.post(f"/api/chats/{a}/documents", files=[pdf("kfs.pdf", KFS)])).status_code == 404
    assert (await c.patch(f"/api/chats/{a}", json={"title": "mine"})).status_code == 404


@pytest.mark.parametrize("q,expected", [
    ("What is the EMI on the home loan in the key facts statement?", "EMI on the home loan"),
    ("Can you please explain the penal charges?", "Penal charges"),
    ("prepayment rules", "Prepayment rules"),
    ("What is the prepayment penalty on a floating-rate home loan today?", "Prepayment penalty"),
    ("What penal charge applies to an overdue home loan instalment?", "Penal charge applies"),
])
def test_short_title(q, expected):
    assert short_title(q) == expected


async def test_upload_order_and_failed_reupload(client):
    """Several PDFs in one chat, uploaded in any order (an amending circular before the policy it amends), all
    resolve; a PDF whose reading failed or was cut off is read again when uploaded again, not left stuck."""
    c = client
    await sign_in(c, "order@bank.example")
    chat = (await c.post("/api/chats", json={})).json()["id"]
    r = await c.post(f"/api/chats/{chat}/documents", files=[pdf("c.pdf", CIRC_C), pdf("b.pdf", CIRC_B)])
    assert [x["status"] for x in r.json()] == ["queued", "queued"]
    r = await c.post(f"/api/chats/{chat}/documents", files=[pdf("master.pdf", MASTER), pdf("kfs.pdf", KFS)])
    assert [x["status"] for x in r.json()] == ["queued", "queued"]
    docs = (await c.get(f"/api/chats/{chat}/documents")).json()
    assert len(docs) == 4 and all(d["ingest_status"] == "indexed" for d in docs), docs
    master = next(d["id"] for d in docs if d["title"].startswith("Master"))
    ams = (await c.get("/api/amendments", headers=KEY)).json()
    assert len(ams) == 2 and all(a["status"] == "confirmed" and a["root_key"] == f"{master}:7.2" for a in ams), ams
    a = await ask(c, chat)
    assert "Nil" in a["claims"][0]["text"], a["claims"]  # C -> B -> A chain, though C was read first

    # simulate a restart mid-ingest: the KFS was left half-read; uploading it again reads it again
    from app.db import SessionLocal
    from app.models import Document
    kfs = next(d["id"] for d in docs if d["filename"] == "kfs.pdf")
    async with SessionLocal() as s:
        (await s.get(Document, kfs)).ingest_status = "parsing"
        await s.commit()
    r = (await c.post(f"/api/chats/{chat}/documents", files=[pdf("kfs.pdf", KFS)])).json()
    assert r[0]["status"] == "duplicate" and r[0]["job_id"], r
    assert next(d for d in (await c.get(f"/api/chats/{chat}/documents")).json() if d["id"] == kfs)["ingest_status"] == "indexed"
    # an already-indexed duplicate is only linked, not read again
    assert (await c.post(f"/api/chats/{chat}/documents", files=[pdf("kfs.pdf", KFS)])).json()[0]["job_id"] is None


async def test_edit_branches_like_chatgpt(client):
    """Editing question 2 of 4 starts a new branch: turns 3-4 leave the screen; '1 of 2' on turn 2 brings them back,
    '2 of 2' shows the edited branch with its own follow-ups. Shares and follow-up context use the branch on screen."""
    c = client
    await sign_in(c, "edit@bank.example")
    chat = (await c.post("/api/chats", json={})).json()["id"]
    await c.post(f"/api/chats/{chat}/documents", files=[pdf("master.pdf", MASTER)])
    for i in range(4):
        await ask(c, chat, q=f"{Q} ({i + 1})")
    view = lambda d: [(t["turn"], t["active"], len(t["versions"]), t["versions"][t["active"] - 1]["question"][-3:]) for t in d["turns"]]

    r = await c.put(f"/api/chats/{chat}/turns/2?stream=false", json={"question": "What are the penal charges on an overdue instalment?"})
    assert r.status_code == 200, r.text
    d = (await c.get(f"/api/chats/{chat}")).json()
    assert [(t["turn"], t["active"], len(t["versions"])) for t in d["turns"]] == [(1, 1, 1), (2, 2, 2)], view(d)
    await ask(c, chat, q=f"{Q} (b3)")  # the edited branch continues as turn 3
    d = (await c.get(f"/api/chats/{chat}")).json()
    assert len(d["turns"]) == 3 and d["turns"][2]["versions"][0]["question"].endswith("(b3)")

    # back to version 1 of turn 2: the original turns 3 and 4 come back
    d = (await c.post(f"/api/chats/{chat}/turns/2/select", json={"version": 1})).json()
    assert [x[3] for x in view(d)] == ["(1)", "(2)", "(3)", "(4)"], view(d)
    assert d == (await c.get(f"/api/chats/{chat}")).json()  # the choice is saved
    share = (await c.post(f"/api/chats/{chat}/shares", json={})).json()
    snap = (await c.get(f"/public/shares/{share['token']}")).json()
    assert [t["question"][-3:] for t in snap["turns"]] == ["(1)", "(2)", "(3)", "(4)"]
    # and forward again to version 2, with its own follow-up
    d = (await c.post(f"/api/chats/{chat}/turns/2/select", json={"version": 2})).json()
    assert [x[3] for x in view(d)] == ["(1)", "nt?", "b3)"], view(d)
    assert (await c.post(f"/api/chats/{chat}/turns/2/select", json={"version": 9})).status_code == 404

    # re-running turn 1 is a new branch too; its old branch stays reachable
    assert (await c.post(f"/api/chats/{chat}/turns/1/regenerate?stream=false")).status_code == 200
    d = (await c.get(f"/api/chats/{chat}")).json()
    assert [(t["turn"], t["active"], len(t["versions"])) for t in d["turns"]] == [(1, 2, 2)], view(d)
    d = (await c.post(f"/api/chats/{chat}/turns/1/select", json={"version": 1})).json()
    assert len(d["turns"]) == 3, view(d)  # the most recently used branch under version 1
