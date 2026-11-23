"""Sign in with Google (ID token from Google Identity Services), email/password fallback, refresh, logout, me,
and admin user management."""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from google.auth import exceptions as g_exceptions
from google.auth.transport import requests as g_requests
from google.oauth2 import id_token as g_id_token
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import RefreshToken, User
from app.security import (ACCESS_COOKIE, Principal, check_password, decode, get_principal, hash_password, make_access_token,
                          make_refresh_token, require_admin)

router = APIRouter(prefix="/api/auth", tags=["auth"])
users = APIRouter(prefix="/api/users", tags=["users"])
COOKIE = "zg_refresh"
_g_req = g_requests.Request()


class GoogleIn(BaseModel):
    credential: str = Field(description="the ID token (JWT) returned by the Google Sign-In button")


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None
    picture: str | None
    role: str
    active: bool
    created_at: datetime
    last_login_at: datetime | None
    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


GOOGLE_CLOCK_SKEW_S = 10  # google-auth defaults to 0: a PC clock a second behind Google fails a fresh token ("used too early")


def verify_google_token(credential: str) -> dict:
    """Checks Google's signature, audience (our client id), issuer and expiry. Separate function so tests can stub it."""
    cid = get_settings().google_client_id
    if not cid:
        raise HTTPException(503, "Google sign-in is not configured (GOOGLE_CLIENT_ID)")
    try:
        return g_id_token.verify_oauth2_token(credential, _g_req, cid, clock_skew_in_seconds=GOOGLE_CLOCK_SKEW_S)
    except g_exceptions.TransportError:  # not a ValueError: would surface as a bare 500
        raise HTTPException(503, "Could not reach Google to verify the sign-in. Try again.")
    except (ValueError, g_exceptions.GoogleAuthError) as e:  # wrong issuer raises GoogleAuthError, not ValueError
        msg = str(e)
        if "audience" in msg.lower():
            msg = "this token was issued for a different Google client ID than the server's GOOGLE_CLIENT_ID"
        elif "too early" in msg.lower() or "expired" in msg.lower():
            msg += " (check that this computer's clock is synced)"
        raise HTTPException(401, f"Google sign-in failed: {msg}")


async def _issue(session: AsyncSession, user: User, response: Response) -> TokenOut:
    s = get_settings()
    user.last_login_at = datetime.now(timezone.utc)
    refresh, exp = await make_refresh_token(session, user)
    await session.commit()
    response.set_cookie(COOKIE, refresh, httponly=True, secure=s.cookie_secure, samesite=s.cookie_samesite,
                        expires=exp, path="/api/auth")
    access, ttl = make_access_token(user)
    # same token as an HttpOnly cookie so <img src="/api/..."> page renders authenticate in the browser
    response.set_cookie(ACCESS_COOKIE, access, httponly=True, secure=s.cookie_secure, samesite=s.cookie_samesite,
                        max_age=ttl, path="/")
    return TokenOut(access_token=access, expires_in=ttl, user=UserOut.model_validate(user))


@router.post("/google", response_model=TokenOut)
async def google_login(body: GoogleIn, response: Response, session: AsyncSession = Depends(get_session)):
    s = get_settings()
    info = await asyncio.to_thread(verify_google_token, body.credential)
    email = (info.get("email") or "").lower()
    if not email or not info.get("email_verified"):
        raise HTTPException(401, "Google account email is not verified")
    if s.domain_list and email.split("@")[-1] not in s.domain_list:
        raise HTTPException(403, "this email domain is not allowed")
    user = (await session.execute(select(User).where((User.google_sub == info["sub"]) | (User.email == email)))).scalars().first()
    if user is None:
        user = User(email=email, role="admin" if email in s.admin_list else "viewer", active=True)
        session.add(user)
    if not user.active:
        raise HTTPException(403, "account disabled")
    user.google_sub, user.name, user.picture = info["sub"], info.get("name") or user.name, info.get("picture")
    if email in s.admin_list:
        user.role = "admin"
    await session.flush()
    return await _issue(session, user, response)


@router.post("/login", response_model=TokenOut)
async def password_login(body: LoginIn, response: Response, session: AsyncSession = Depends(get_session)):
    if not get_settings().allow_password_login:
        raise HTTPException(403, "password login is disabled")
    user = (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none()
    if user is None or not user.active or not check_password(body.password, user.password_hash):
        raise HTTPException(401, "wrong email or password")
    return await _issue(session, user, response)


@router.post("/refresh", response_model=TokenOut)
async def refresh(response: Response, zg_refresh: str | None = Cookie(default=None),
                  session: AsyncSession = Depends(get_session)):
    if not zg_refresh:
        raise HTTPException(401, "no refresh token")
    data = decode(zg_refresh, "refresh")
    row = await session.get(RefreshToken, data["jti"])
    if row is None or row.revoked:
        if row is not None:  # reuse of a rotated token: revoke the whole family for safety
            for t in (await session.execute(select(RefreshToken).where(RefreshToken.user_id == row.user_id))).scalars():
                t.revoked = True
            await session.commit()
        raise HTTPException(401, "refresh token revoked")
    user = await session.get(User, row.user_id)
    if user is None or not user.active:
        raise HTTPException(401, "account disabled")
    row.revoked = True  # rotation: each refresh token works once
    return await _issue(session, user, response)


@router.post("/logout", status_code=204)
async def logout(response: Response, zg_refresh: str | None = Cookie(default=None),
                 session: AsyncSession = Depends(get_session)):
    if zg_refresh:
        try:
            row = await session.get(RefreshToken, decode(zg_refresh, "refresh")["jti"])
            if row:
                row.revoked = True
                await session.commit()
        except HTTPException:
            pass
    response.delete_cookie(COOKIE, path="/api/auth")
    response.delete_cookie(ACCESS_COOKIE, path="/")


@router.get("/me", response_model=UserOut | None)
async def me(p: Principal = Depends(get_principal)):
    if p.user is None:
        raise HTTPException(400, "service credentials have no user profile")
    return UserOut.model_validate(p.user)


@router.get("/config")
async def auth_config():
    """Public: what the login page should show."""
    s = get_settings()
    return {"google_client_id": s.google_client_id or None, "password_login": s.allow_password_login}


# ---------------------------------------------------------------- admin: users
class UserCreate(BaseModel):
    email: EmailStr
    password: str | None = Field(None, min_length=8)
    name: str | None = None
    role: str = Field("viewer", pattern="^(admin|viewer)$")


class UserPatch(BaseModel):
    role: str | None = Field(None, pattern="^(admin|viewer)$")
    active: bool | None = None
    password: str | None = Field(None, min_length=8)


@users.get("", response_model=list[UserOut])
async def list_users(_: Principal = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    return (await session.execute(select(User).order_by(User.created_at))).scalars().all()


@users.post("", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, _: Principal = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    if (await session.execute(select(User).where(User.email == body.email.lower()))).scalar_one_or_none():
        raise HTTPException(409, "user exists")
    u = User(email=body.email.lower(), name=body.name, role=body.role,
             password_hash=hash_password(body.password) if body.password else None)
    session.add(u)
    await session.commit()
    return u


@users.patch("/{user_id}", response_model=UserOut)
async def patch_user(user_id: str, body: UserPatch, p: Principal = Depends(require_admin),
                     session: AsyncSession = Depends(get_session)):
    u = await session.get(User, user_id)
    if u is None:
        raise HTTPException(404, "user not found")
    if body.role is not None:
        u.role = body.role
    if body.active is not None:
        if p.user_id == u.id and body.active is False:
            raise HTTPException(400, "you cannot disable yourself")
        u.active = body.active
        if not body.active:
            for t in (await session.execute(select(RefreshToken).where(RefreshToken.user_id == u.id))).scalars():
                t.revoked = True
    if body.password:
        u.password_hash = hash_password(body.password)
    await session.commit()
    return u


async def seed_admin(session: AsyncSession) -> None:
    s = get_settings()
    if not (s.seed_admin_email and s.seed_admin_password):
        return
    email = s.seed_admin_email.lower()
    u = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if u is None:
        session.add(User(email=email, name="Admin", role="admin", password_hash=hash_password(s.seed_admin_password)))
        await session.commit()
