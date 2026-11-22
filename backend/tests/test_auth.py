import httpx
import pytest
from sqlalchemy import text

from app.api import auth as auth_api
from app.config import get_settings
from app.db import Base, engine, init_db
from app.main import app

KEY = {"X-API-Key": "test-key"}


@pytest.fixture
async def client(monkeypatch):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
    await init_db()
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "test-client.apps.googleusercontent.com")
    monkeypatch.setattr(s, "admin_emails", "boss@bank.example")
    monkeypatch.setattr(s, "allowed_email_domains", "")

    def fake_verify(credential: str) -> dict:  # stands in for Google's signature/audience check
        email = credential.split(":", 1)[1]
        return {"sub": f"g-{email}", "email": email, "email_verified": True, "name": email.split("@")[0], "picture": None}

    monkeypatch.setattr(auth_api, "verify_google_token", fake_verify)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c
    await engine.dispose()


def bearer(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def test_password_login_refresh_rotation_and_roles(client):
    c = client
    r = await c.post("/api/users", headers=KEY, json={"email": "viewer@bank.example", "password": "secret-pass-1"})
    assert r.status_code == 201 and r.json()["role"] == "viewer"

    assert (await c.post("/api/auth/login", json={"email": "viewer@bank.example", "password": "wrong-pass"})).status_code == 401
    r = await c.post("/api/auth/login", json={"email": "viewer@bank.example", "password": "secret-pass-1"})
    assert r.status_code == 200
    tok = r.json()["access_token"]
    first_refresh = c.cookies.get("zg_refresh")
    assert first_refresh and c.cookies.get("zg_access")

    me = (await c.get("/api/auth/me", headers=bearer(tok))).json()
    assert me["email"] == "viewer@bank.example" and me["role"] == "viewer"

    # viewer can read but not manage
    assert (await c.get("/api/documents", headers=bearer(tok))).status_code == 200
    up = await c.post("/api/documents", headers=bearer(tok), files=[("files", ("x.pdf", b"%PDF-1.4", "application/pdf"))])
    assert up.status_code == 403
    assert (await c.get("/api/users", headers=bearer(tok))).status_code == 403

    # refresh rotates; reusing the old refresh token is rejected and revokes the family
    r2 = await c.post("/api/auth/refresh")
    assert r2.status_code == 200 and c.cookies.get("zg_refresh") != first_refresh
    c.cookies.set("zg_refresh", first_refresh, path="/api/auth")
    assert (await c.post("/api/auth/refresh")).status_code == 401

    # disabled users are locked out immediately
    uid = me["id"]
    await c.patch(f"/api/users/{uid}", headers=KEY, json={"active": False})
    assert (await c.get("/api/auth/me", headers=bearer(tok))).status_code == 401


async def test_google_signin_admin_promotion_and_chat_isolation(client):
    c = client
    boss = (await c.post("/api/auth/google", json={"credential": "x:boss@bank.example"})).json()
    assert boss["user"]["role"] == "admin"
    c.cookies.clear()
    ana = (await c.post("/api/auth/google", json={"credential": "x:ana@gmail.example"})).json()
    assert ana["user"]["role"] == "viewer"
    c.cookies.clear()

    chat = (await c.post("/api/chats", headers=bearer(ana["access_token"]), json={})).json()["id"]
    assert (await c.get(f"/api/chats/{chat}", headers=bearer(ana["access_token"]))).status_code == 200
    assert (await c.get(f"/api/chats/{chat}", headers=bearer(boss["access_token"]))).status_code == 404  # not hers
    assert [x["id"] for x in (await c.get("/api/chats", headers=bearer(boss["access_token"]))).json()] == []

    # signing in again keeps the same account
    again = (await c.post("/api/auth/google", json={"credential": "x:ana@gmail.example"})).json()
    assert again["user"]["id"] == ana["user"]["id"]

    # cookie-only auth works (what <img src> uses)
    c.cookies.clear()
    await c.post("/api/auth/google", json={"credential": "x:ana@gmail.example"})
    assert (await c.get("/api/documents")).status_code == 200
    await c.post("/api/auth/logout")
    c.cookies.clear()
    assert (await c.get("/api/documents")).status_code == 401


async def test_domain_restriction_and_config(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "allowed_email_domains", "bank.example")
    assert (await client.post("/api/auth/google", json={"credential": "x:someone@gmail.example"})).status_code == 403
    assert (await client.post("/api/auth/google", json={"credential": "x:staff@bank.example"})).status_code == 200
    cfg = (await client.get("/api/auth/config")).json()
    assert cfg["google_client_id"].endswith("googleusercontent.com") and cfg["password_login"] is True
