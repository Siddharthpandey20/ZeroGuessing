import httpx
import pytest
from sqlalchemy import text

from app.db import Base, engine, init_db
from app.ingest.htmlpdf import html_to_pdf
from app.main import app
from tests.test_parse import HTML

H = {"X-API-Key": "test-key"}


@pytest.fixture
async def client():
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c
    await engine.dispose()


async def test_auth_required(client):
    assert (await client.get("/api/documents")).status_code == 401
    assert (await client.get("/health")).status_code == 200


async def test_upload_library_render(client):
    pdf = html_to_pdf(HTML, footer="Sunrise Co-operative Bank")
    r = await client.post("/api/documents", headers=H, files=[("files", ("master.pdf", pdf, "application/pdf")),
                                                             ("files", ("notes.txt", b"hello", "text/plain"))])
    assert r.status_code == 202
    res = r.json()
    assert res[0]["status"] == "queued" and res[1]["status"] == "rejected"
    doc_id = res[0]["document_id"]

    # background ingest has run by the time ASGITransport returns
    lib = (await client.get("/api/documents", headers=H)).json()
    assert len(lib) == 1
    d = lib[0]
    assert d["title"].startswith("Master Policy") and d["uploaded_at"] and d["n_clauses"] >= 6
    assert d["ingest_status"] in ("indexed", "indexed_no_vectors")

    dup = (await client.post("/api/documents", headers=H, files=[("files", ("again.pdf", pdf, "application/pdf"))])).json()
    assert dup[0]["status"] == "duplicate"

    detail = (await client.get(f"/api/documents/{doc_id}", headers=H)).json()
    assert any(c["ref"] == "7.2" for c in detail["clauses"])

    img = await client.get(f"/api/documents/{doc_id}/pages/1.png", headers=H)
    assert img.status_code == 200 and img.content[:4] == b"\x89PNG"

    p = (await client.patch(f"/api/documents/{doc_id}", headers=H, json={"active": False})).json()
    assert p["active"] is False
