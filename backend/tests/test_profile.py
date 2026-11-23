"""Profile: view and edit details, profile photo (re-encoded, metadata stripped), change or set a password."""

import io

import httpx
import pytest
from PIL import Image

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
        return {"sub": f"g-{email}", "email": email, "email_verified": True, "name": "Google Name",
                "picture": "https://lh3.example/photo.jpg"}

    monkeypatch.setattr(auth_api, "verify_google_token", fake_verify)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c
    await engine.dispose()


def bearer(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


async def signup(c, email="asha@bank.example", password="long-enough-1") -> str:
    r = await c.post("/api/auth/signup", json={"email": email, "password": password, "name": "Asha"})
    assert r.status_code == 201, r.text
    return r.json()["access_token"]


def jpeg(w: int, h: int, exif: bool = False) -> bytes:
    img = Image.new("RGB", (w, h), (200, 40, 40))
    buf = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SecretCam"  # Make
        ex[0x0112] = 6  # Orientation: rotate 90 when shown
        img.save(buf, "JPEG", exif=ex)
    else:
        img.save(buf, "JPEG")
    return buf.getvalue()


async def test_view_and_edit_profile(client):
    c = client
    tok = await signup(c)
    p = (await c.get("/api/profile", headers=bearer(tok))).json()
    assert p["email"] == "asha@bank.example" and p["name"] == "Asha" and p["role"] == "viewer"
    assert p["has_password"] is True and p["google_linked"] is False and p["job_title"] is None

    r = await c.patch("/api/profile", headers=bearer(tok),
                      json={"name": "  Asha Verma ", "job_title": "Claims officer", "organisation": "Raipur Branch"})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Asha Verma" and r.json()["job_title"] == "Claims officer"
    # cleared with an empty string; the name itself cannot be emptied
    r = await c.patch("/api/profile", headers=bearer(tok), json={"organisation": "  "})
    assert r.json()["organisation"] is None
    assert (await c.patch("/api/profile", headers=bearer(tok), json={"name": "   "})).status_code == 422
    assert (await c.patch("/api/profile", headers=bearer(tok), json={"job_title": "x" * 81})).status_code == 422
    # role and email are not editable here
    r = await c.patch("/api/profile", headers=bearer(tok), json={"role": "admin", "email": "evil@x.example"})
    assert r.status_code == 200 and r.json()["role"] == "viewer" and r.json()["email"] == "asha@bank.example"
    c.cookies.clear()
    assert (await c.get("/api/profile")).status_code == 401  # signed out


async def test_photo_upload_is_square_reencoded_and_stripped(client):
    c = client
    tok = await signup(c)
    r = await c.post("/api/profile/photo", headers=bearer(tok), files={"photo": ("me.jpg", jpeg(900, 600, exif=True), "image/jpeg")})
    assert r.status_code == 200, r.text
    pic = r.json()["picture"]
    assert pic.startswith("/api/profile/photo/")
    me = (await c.get("/api/auth/me", headers=bearer(tok))).json()
    assert me["picture"] == pic  # the top bar avatar uses it

    img = await c.get(pic, headers=bearer(tok))
    assert img.status_code == 200 and img.headers["content-type"] == "image/jpeg"
    out = Image.open(io.BytesIO(img.content))
    assert out.size[0] == out.size[1] <= 512  # square, resized
    assert b"SecretCam" not in img.content and not out.getexif()  # camera metadata removed

    # another user cannot read it; an admin (service key) can
    other = await signup(c, "ravi@bank.example")
    assert (await c.get(pic, headers=bearer(other))).status_code == 404
    assert (await c.get(pic, headers=KEY)).status_code == 200

    assert (await c.delete("/api/profile/photo", headers=bearer(tok))).json()["picture"] is None


async def test_photo_rejects_non_images_and_huge_files(client):
    c = client
    tok = await signup(c)
    bad = await c.post("/api/profile/photo", headers=bearer(tok), files={"photo": ("x.png", b"<svg onload=alert(1)>", "image/png")})
    assert bad.status_code == 415
    pdf = await c.post("/api/profile/photo", headers=bearer(tok), files={"photo": ("x.pdf", b"%PDF-1.4", "application/pdf")})
    assert pdf.status_code == 415
    big = await c.post("/api/profile/photo", headers=bearer(tok),
                       files={"photo": ("big.jpg", b"\xff\xd8" + b"0" * (6 * 1024 * 1024), "image/jpeg")})
    assert big.status_code == 413


async def test_google_keeps_edited_name_and_uploaded_photo(client):
    c = client
    g = (await c.post("/api/auth/google", json={"credential": "x:meera@bank.example"})).json()
    tok = g["access_token"]
    assert g["user"]["name"] == "Google Name"
    await c.patch("/api/profile", headers=bearer(tok), json={"name": "Meera S"})
    up = await c.post("/api/profile/photo", headers=bearer(tok), files={"photo": ("me.jpg", jpeg(300, 300), "image/jpeg")})
    mine = up.json()["picture"]
    again = (await c.post("/api/auth/google", json={"credential": "x:meera@bank.example"})).json()["user"]
    assert again["name"] == "Meera S" and again["picture"] == mine  # a later Google sign-in does not overwrite them


async def test_change_and_set_password(client):
    c = client
    tok = await signup(c)
    wrong = await c.post("/api/profile/password", headers=bearer(tok), json={"current_password": "nope-nope", "new_password": "new-secret-2"})
    assert wrong.status_code == 400
    ok = await c.post("/api/profile/password", headers=bearer(tok), json={"current_password": "long-enough-1", "new_password": "new-secret-2"})
    assert ok.status_code == 200
    assert (await c.post("/api/auth/login", json={"email": "asha@bank.example", "password": "long-enough-1"})).status_code == 401
    assert (await c.post("/api/auth/login", json={"email": "asha@bank.example", "password": "new-secret-2"})).status_code == 200

    # a Google-only account can set a first password without a current one
    g = (await c.post("/api/auth/google", json={"credential": "x:gita@bank.example"})).json()["access_token"]
    assert (await c.get("/api/profile", headers=bearer(g))).json()["has_password"] is False
    r = await c.post("/api/profile/password", headers=bearer(g), json={"new_password": "first-pass-3"})
    assert r.status_code == 200 and r.json()["has_password"] is True
