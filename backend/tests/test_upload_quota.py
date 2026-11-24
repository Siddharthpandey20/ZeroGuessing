"""Per-user upload quota (S6): a signed-in user holds at most 5 PDFs / 30 MB across all their chats. Files over the
quota are rejected one by one with a reason; files they already have and the demo documents are free; removing a PDF
frees its slot; admins and the service key are exempt; parallel uploads can't slip past the limit."""

import asyncio
import os

import httpx
import pymupdf

from app.config import get_settings
from tests.test_chat_docs import KEY, client, sign_in  # noqa: F401  (fixture)

MB = 1024 * 1024


def fake_pdf(name: str, size: int = 2048, pages: int = 1):
    """A real, unique PDF of about `size` bytes (random padding in an attached file, which doesn't compress)."""
    doc = pymupdf.open()
    for i in range(pages):
        doc.new_page().insert_text((72, 72), f"{name} page {i + 1} {os.urandom(4).hex()}")
    doc.embfile_add("pad", os.urandom(max(0, size - 1500)))
    return ("files", (name, doc.tobytes(), "application/pdf"))


async def new_chat(c: httpx.AsyncClient, **kw) -> str:
    return (await c.post("/api/chats", json={}, **kw)).json()["id"]


async def upload(c: httpx.AsyncClient, chat: str, files, **kw) -> list[dict]:
    r = await c.post(f"/api/chats/{chat}/documents", files=files, **kw)
    assert r.status_code == 202, r.text
    return r.json()


def test_defaults():
    s = get_settings()
    assert (s.max_user_documents, s.max_user_upload_mb) == (5, 30)


async def test_count_limit_across_chats(client):
    c = client
    await sign_in(c, "ana@bank.example")
    a, b = await new_chat(c), await new_chat(c)

    first = [fake_pdf(f"a{i}.pdf") for i in range(3)]
    assert [r["status"] for r in await upload(c, a, first)] == ["queued"] * 3
    # a batch is admitted in order until the limit: 2 more fit (5 in all, over two chats), the rest are rejected
    res = await upload(c, b, [fake_pdf(f"b{i}.pdf") for i in range(4)])
    assert [r["status"] for r in res] == ["queued", "queued", "rejected", "rejected"]
    assert res[2]["document_id"] is None and "upload limit reached" in res[2]["detail"]
    assert len((await c.get(f"/api/chats/{b}/documents")).json()) == 2  # rejected files are not linked

    # one they already have costs nothing: linking it into another chat still works at the limit
    again = await upload(c, b, [first[0]])
    assert again[0]["status"] == "duplicate"
    # the demo documents don't count either
    assert all(r["status"] != "rejected" for r in (await c.post(f"/api/chats/{b}/documents/demo")).json())
    assert (await upload(c, b, [fake_pdf("x.pdf")]))[0]["status"] == "rejected"

    # removing a PDF from every chat that has it frees its slot
    doc = again[0]["document_id"]
    assert (await c.delete(f"/api/chats/{a}/documents/{doc}")).status_code == 204
    assert (await upload(c, a, [fake_pdf("y.pdf")]))[0]["status"] == "rejected"  # still in chat b
    assert (await c.delete(f"/api/chats/{b}/documents/{doc}")).status_code == 204
    assert (await upload(c, a, [fake_pdf("y.pdf")]))[0]["status"] == "queued"

    # a duplicate of someone else's file is a new document for this user, so it counts
    await sign_in(c, "ben@bank.example")
    ben = await new_chat(c)
    assert [r["status"] for r in await upload(c, ben, [first[1]] + [fake_pdf(f"z{i}.pdf") for i in range(5)])] \
        == ["duplicate"] + ["queued"] * 4 + ["rejected"]


async def test_size_limit(client):
    c = client
    await sign_in(c, "ana@bank.example")
    chat = await new_chat(c)
    res = await upload(c, chat, [fake_pdf(f"big{i}.pdf", 8 * MB) for i in range(4)])  # 32 MB > 30 MB
    assert [r["status"] for r in res] == ["queued"] * 3 + ["rejected"]
    assert "storage limit reached" in res[3]["detail"] and "6.0 MB left" in res[3]["detail"]
    # a file that still fits is accepted (24 MB + 5 MB)
    assert (await upload(c, chat, [fake_pdf("mid.pdf", 5 * MB)]))[0]["status"] == "queued"
    assert (await upload(c, chat, [fake_pdf("more.pdf", 2 * MB)]))[0]["status"] == "rejected"


async def test_parallel_uploads_cannot_exceed_quota(client):
    c = client
    await sign_in(c, "ana@bank.example")
    a, b = await new_chat(c), await new_chat(c)
    res = await asyncio.gather(upload(c, a, [fake_pdf(f"p{i}.pdf") for i in range(4)]),
                               upload(c, b, [fake_pdf(f"q{i}.pdf") for i in range(4)]))
    statuses = [r["status"] for batch in res for r in batch]
    assert statuses.count("queued") == 5 and statuses.count("rejected") == 3


async def test_admins_and_service_key_are_exempt(client):
    c = client
    assert (await c.post("/api/users", headers=KEY, json={"email": "boss@bank.example", "password": "secret-pass-1",
                                                          "role": "admin"})).status_code == 201
    assert (await c.post("/api/auth/login", json={"email": "boss@bank.example", "password": "secret-pass-1"})).status_code == 200
    chat = await new_chat(c)
    assert all(r["status"] == "queued" for r in await upload(c, chat, [fake_pdf(f"s{i}.pdf") for i in range(7)]))

    c.cookies.clear()
    svc = await new_chat(c, headers=KEY)
    assert all(r["status"] == "queued" for r in await upload(c, svc, [fake_pdf(f"k{i}.pdf") for i in range(7)], headers=KEY))
    lib = (await c.post("/api/documents", headers=KEY, files=[fake_pdf(f"l{i}.pdf") for i in range(7)])).json()
    assert all(r["status"] == "queued" for r in lib)
