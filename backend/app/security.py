"""Authentication and roles.

Accepted credentials for /api/* (explicit headers win over cookies):
  1. `Authorization: Bearer <access JWT>`: a signed-in user (Google sign-in or email/password, see app/api/auth.py)
  2. `zg_access` HttpOnly cookie holding the same access JWT: set at sign-in so the browser app's <img> tags
     (page renders, crops) authenticate same-origin without headers
  3. `X-API-Key: <API_KEY>`: scripts/eval/server-to-server; acts as admin
  4. `zg_session` HttpOnly cookie from POST /auth/session with the admin key (kept for the early frontend build)
Roles: admin (manage documents, amendments, scans, users) | viewer (ask, chat, share, read library/alerts).
Access tokens are short-lived HS256 JWTs. Refresh tokens are server-tracked and rotated on every use.
"""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.models import RefreshToken, User

ALG = "HS256"
ACCESS_COOKIE = "zg_access"
SESSION_COOKIE = "zg_session"
_ph = PasswordHasher()


@dataclass
class Principal:
    kind: str  # user | service
    role: str  # admin | viewer
    user: User | None = None

    @property
    def user_id(self) -> str | None:
        return self.user.id if self.user else None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


# ---------------------------------------------------------------- passwords + tokens
def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def check_password(pw: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return _ph.verify(hashed, pw)
    except VerifyMismatchError:
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_access_token(user: User) -> tuple[str, int]:
    s = get_settings()
    ttl = s.access_ttl_min * 60
    payload = {"sub": user.id, "email": user.email, "role": user.role, "typ": "access",
               "iat": _now(), "exp": _now() + timedelta(seconds=ttl)}
    return jwt.encode(payload, s.jwt_secret, algorithm=ALG), ttl


async def make_refresh_token(session: AsyncSession, user: User) -> tuple[str, datetime]:
    s = get_settings()
    jti = secrets.token_urlsafe(32)
    exp = _now() + timedelta(days=s.refresh_ttl_days)
    session.add(RefreshToken(id=jti, user_id=user.id, expires_at=exp))
    token = jwt.encode({"sub": user.id, "jti": jti, "typ": "refresh", "exp": exp}, s.jwt_secret, algorithm=ALG)
    return token, exp


def decode(token: str, typ: str) -> dict:
    try:
        data = jwt.decode(token, get_settings().jwt_secret, algorithms=[ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    if data.get("typ") != typ:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong token type")
    return data


def _session_token() -> str:
    """Admin-key session cookie value, derived from the key (the key never sits in the browser)."""
    return hmac.new(get_settings().api_key.encode(), b"zeroguess-session-v1", hashlib.sha256).hexdigest()


# ---------------------------------------------------------------- dependencies
async def get_principal(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    zg_access: str | None = Cookie(default=None),
    zg_session: str | None = Cookie(default=None),
    session: AsyncSession = Depends(get_session),
) -> Principal:
    # explicit headers win over ambient cookies
    bearer = authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else None
    if bearer is None and x_api_key and secrets.compare_digest(x_api_key, get_settings().api_key):
        return Principal("service", "admin")
    token = bearer or zg_access
    if token:
        data = decode(token, "access")
        user = await session.get(User, data["sub"])
        if user is None or not user.active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user disabled or not found")
        return Principal("user", user.role, user)
    if zg_session and secrets.compare_digest(zg_session, _session_token()):
        return Principal("service", "admin")
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "sign in required", headers={"WWW-Authenticate": "Bearer"})


async def require_admin(p: Principal = Depends(get_principal)) -> Principal:
    if not p.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    return p


require_api_key = get_principal  # router-level dependency name used in main.py


# ---------------------------------------------------------------- admin-key browser session (early frontend)
auth_router = APIRouter(prefix="/auth", tags=["auth"])


class SessionIn(BaseModel):
    key: str


@auth_router.post("/session", status_code=204)
async def key_login(body: SessionIn, response: Response) -> None:
    if not secrets.compare_digest(body.key, get_settings().api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "That access key is not valid")
    s = get_settings()
    response.set_cookie(SESSION_COOKIE, _session_token(), httponly=True, secure=s.cookie_secure, samesite=s.cookie_samesite,
                        max_age=60 * 60 * 24 * 7, path="/")


@auth_router.get("/session")
async def session_state(zg_session: str | None = Cookie(default=None)) -> dict:
    return {"signed_in": bool(zg_session) and secrets.compare_digest(zg_session or "", _session_token())}


@auth_router.delete("/session", status_code=204)
async def key_logout(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
