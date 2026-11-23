import httpx
import pytest

from app.api import auth as auth_api
from app.config import get_settings
from app.db import engine, init_db
from app.main import app
from tests.conftest import reset_db

KEY = {"X-API-Key": "test-key"}


@pytest.fixture
async def client(monkeypatch):
    async with engine.begin() as conn:
        await reset_db(conn)
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


# ---------------------------------------------------------------- the real Google verifier (only the cert download is faked)
REAL_VERIFY = auth_api.verify_google_token  # captured before the fixture swaps in the stub


def _google_like_token(aud: str, iat_offset: int = 0, iss: str = "https://accounts.google.com"):
    """An RS256 ID token shaped like the one GIS hands the browser, signed by a throwaway key, plus that key's public PEM."""
    import time

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from google.auth import crypt, jwt as g_jwt

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    pub = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    now = int(time.time()) + iat_offset
    claims = {"iss": iss, "aud": aud, "sub": "g-real-1", "email": "Real.User@Gmail.Example", "email_verified": True,
              "name": "Real User", "iat": now, "exp": now + 3600}
    token = g_jwt.encode(crypt.RSASigner.from_string(priv, key_id="k1"), claims)
    return token.decode(), {"k1": pub.decode()}


async def test_real_google_verifier_audience_skew_and_cookies(client, monkeypatch):
    from google.auth import exceptions as g_exc
    from google.oauth2 import id_token as g_id

    cid = get_settings().google_client_id
    monkeypatch.setattr(auth_api, "verify_google_token", REAL_VERIFY)

    # Google's clock 5s ahead of ours (iat in our future): google-auth's default skew of 0 rejects this
    tok, certs = _google_like_token(cid, iat_offset=5)
    monkeypatch.setattr(g_id, "_fetch_certs", lambda req, url: certs)
    r = await client.post("/api/auth/google", json={"credential": tok})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "real.user@gmail.example" and r.json()["user"]["role"] == "viewer"
    assert {"zg_access", "zg_refresh"} <= set(r.cookies.keys())
    set_cookies = r.headers.get_list("set-cookie")
    assert any(h.startswith("zg_refresh=") and "Path=/api/auth" in h and "HttpOnly" in h for h in set_cookies)
    assert any(h.startswith("zg_access=") and "Path=/" in h and "SameSite=lax" in h and "Secure" not in h for h in set_cookies)
    me = await client.get("/api/auth/me")  # the access cookie alone authenticates
    assert me.status_code == 200 and me.json()["email"] == "real.user@gmail.example"

    # token minted for another OAuth client: 401 with a message a person can act on
    tok, certs = _google_like_token("someone-else.apps.googleusercontent.com")
    monkeypatch.setattr(g_id, "_fetch_certs", lambda req, url: certs)
    r = await client.post("/api/auth/google", json={"credential": tok})
    assert r.status_code == 401 and "different Google client ID" in r.json()["detail"]

    # not issued by Google
    tok, certs = _google_like_token(cid, iss="https://evil.example")
    monkeypatch.setattr(g_id, "_fetch_certs", lambda req, url: certs)
    assert (await client.post("/api/auth/google", json={"credential": tok})).status_code == 401

    # Google's certs unreachable: 503, not a bare 500
    def offline(req, url):
        raise g_exc.TransportError("no network")

    monkeypatch.setattr(g_id, "_fetch_certs", offline)
    r = await client.post("/api/auth/google", json={"credential": tok})
    assert r.status_code == 503 and "reach Google" in r.json()["detail"]


def test_client_id_is_trimmed():
    from app.config import Settings

    assert Settings(google_client_id='  "abc.apps.googleusercontent.com" ').google_client_id == "abc.apps.googleusercontent.com"


def test_empty_jwt_secret_falls_back_in_dev_and_fails_in_production():
    import pytest as _pytest
    from pydantic import ValidationError

    from app.config import DEV_JWT_SECRET, Settings

    assert Settings(jwt_secret="", cookie_secure=False).jwt_secret == DEV_JWT_SECRET
    with _pytest.raises(ValidationError, match="JWT_SECRET is empty"):
        Settings(jwt_secret="  ", cookie_secure=True)


async def test_signup_creates_viewer_and_signs_in(client):
    c = client
    assert (await c.get("/api/auth/config")).json()["signup"] is True
    r = await c.post("/api/auth/signup", json={"email": "New.User@Bank.example", "password": "long-enough-1", "name": " Asha "})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["email"] == "new.user@bank.example" and body["user"]["role"] == "viewer"
    assert body["user"]["name"] == "Asha"
    assert c.cookies.get("zg_refresh") and c.cookies.get("zg_access")
    me = await c.get("/api/auth/me", headers=bearer(body["access_token"]))
    assert me.status_code == 200 and me.json()["email"] == "new.user@bank.example"
    # the new password works for later sign-ins
    assert (await c.post("/api/auth/login", json={"email": "new.user@bank.example", "password": "long-enough-1"})).status_code == 200


async def test_signup_rejects_duplicates_weak_passwords_and_disallowed_domains(client, monkeypatch):
    c = client
    ok = {"email": "dup@bank.example", "password": "long-enough-1"}
    assert (await c.post("/api/auth/signup", json=ok)).status_code == 201
    r = await c.post("/api/auth/signup", json={**ok, "password": "another-pass-2"})
    assert r.status_code == 409 and "sign in" in r.json()["detail"].lower()

    assert (await c.post("/api/auth/signup", json={"email": "short@bank.example", "password": "short"})).status_code == 422
    assert (await c.post("/api/auth/signup", json={"email": "same@bank.example", "password": "same@bank.example"})).status_code == 422
    assert (await c.post("/api/auth/signup", json={"email": "not-an-email", "password": "long-enough-1"})).status_code == 422

    s = get_settings()
    monkeypatch.setattr(s, "allowed_email_domains", "bank.example")
    assert (await c.post("/api/auth/signup", json={"email": "x@other.example", "password": "long-enough-1"})).status_code == 403

    monkeypatch.setattr(s, "allow_signup", False)
    assert (await c.get("/api/auth/config")).json()["signup"] is False
    assert (await c.post("/api/auth/signup", json={"email": "y@bank.example", "password": "long-enough-1"})).status_code == 403


async def test_signup_never_grants_admin(client):
    # boss@bank.example is in ADMIN_EMAILS, but sign-up does not prove the address: it stays a viewer
    r = await client.post("/api/auth/signup", json={"email": "boss@bank.example", "password": "long-enough-1"})
    assert r.status_code == 201 and r.json()["user"]["role"] == "viewer"
    tok = r.json()["access_token"]
    assert (await client.get("/api/users", headers=bearer(tok))).status_code == 403


async def test_google_signin_takes_over_unverified_signup_and_drops_its_password(client):
    # someone signs up with an address they do not own; the real owner later signs in with Google
    c = client
    assert (await c.post("/api/auth/signup", json={"email": "owner@gmail.example", "password": "squatter-pass"})).status_code == 201
    g = await c.post("/api/auth/google", json={"credential": "x:owner@gmail.example"})
    assert g.status_code == 200
    # the squatter's password no longer opens the account
    assert (await c.post("/api/auth/login", json={"email": "owner@gmail.example", "password": "squatter-pass"})).status_code == 401
