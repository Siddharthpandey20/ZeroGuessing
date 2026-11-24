"""The signed-in user's own profile: view and edit details, profile photo, change or set a password.

Editable: name, job title, organisation, photo, password. Shown but not editable here: email (it is the sign-in
identity), role (only an admin changes it), how the account signs in, and when it was created and last used.

Photos are decoded and drawn again by Pillow before they are stored: turned the right way up, cropped to a square,
resized, and saved as a fresh JPEG. Whatever was uploaded (a camera photo with its GPS position in the metadata, a
file that is also a script, an oversized image), what is stored and served is only those pixels.
"""

import hashlib
import io
import warnings
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import RefreshToken, User
from app.security import Principal, check_password, get_principal, hash_password
from app.storage import get_storage

router = APIRouter(prefix="/profile", tags=["profile"])

MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_PX = 512  # stored size (square); shown at 28px in the top bar and ~120px on the profile page
MAX_PIXELS = 40_000_000  # refuse decompression bombs: a tiny file that expands to a huge image
_FORMATS = ("JPEG", "PNG", "WEBP")


class ProfileOut(BaseModel):
    id: str
    email: str
    name: str | None
    picture: str | None
    role: str
    job_title: str | None
    organisation: str | None
    has_password: bool
    google_linked: bool
    created_at: datetime
    last_login_at: datetime | None


class ProfilePatch(BaseModel):
    """Fields left out are not changed. An empty job title or organisation clears it; the name cannot be emptied."""
    name: str | None = Field(None, max_length=80)
    job_title: str | None = Field(None, max_length=80)
    organisation: str | None = Field(None, max_length=120)


class PasswordIn(BaseModel):
    current_password: str | None = Field(None, max_length=128)  # not needed when the account has no password yet
    new_password: str = Field(min_length=8, max_length=128)


def _out(u: User) -> ProfileOut:
    return ProfileOut(id=u.id, email=u.email, name=u.name, picture=u.picture, role=u.role, job_title=u.job_title,
                      organisation=u.organisation, has_password=bool(u.password_hash), google_linked=bool(u.google_sub),
                      created_at=u.created_at, last_login_at=u.last_login_at)


async def _me(p: Principal, session: AsyncSession) -> User:
    if p.user is None:
        raise HTTPException(400, "service credentials have no profile")
    u = await session.get(User, p.user.id)
    if u is None:
        raise HTTPException(401, "user not found")
    return u


def _clean(v: str | None) -> str | None:
    """Trim and collapse spaces; blank becomes None."""
    return " ".join((v or "").split()) or None


@router.get("", response_model=ProfileOut)
async def get_profile(p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    return _out(await _me(p, session))


@router.patch("", response_model=ProfileOut)
async def edit_profile(body: ProfilePatch, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    u = await _me(p, session)
    given = body.model_fields_set
    if "name" in given:
        if not _clean(body.name):
            raise HTTPException(422, "Your name cannot be empty.")
        u.name = _clean(body.name)
    if "job_title" in given:
        u.job_title = _clean(body.job_title)
    if "organisation" in given:
        u.organisation = _clean(body.organisation)
    await session.commit()
    return _out(u)


def _normalise_photo(data: bytes) -> bytes:
    """Any JPEG/PNG/WebP -> a square, upright, metadata-free JPEG of PHOTO_PX. Raises ValueError if it is not one."""
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            img = Image.open(io.BytesIO(data), formats=_FORMATS)
            if img.width * img.height > MAX_PIXELS:
                raise ValueError("image too large")
            img.load()
        except (UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError, OSError, SyntaxError) as e:
            raise ValueError(str(e)) from e
    img = ImageOps.exif_transpose(img)  # phone photos store "rotate me" in metadata; apply it before dropping it
    if img.mode in ("RGBA", "LA", "P"):  # transparent areas become white rather than black
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    img = ImageOps.fit(img.convert("RGB"), (PHOTO_PX, PHOTO_PX), Image.Resampling.LANCZOS)  # centre crop to a square
    out = io.BytesIO()
    img.save(out, "JPEG", quality=86, optimize=True)  # no exif= argument: nothing from the original is carried over
    return out.getvalue()


@router.post("/photo", response_model=ProfileOut)
async def upload_photo(photo: UploadFile = File(...), p: Principal = Depends(get_principal),
                       session: AsyncSession = Depends(get_session)):
    u = await _me(p, session)
    data = await photo.read(MAX_PHOTO_BYTES + 1)
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "That photo is larger than 5 MB. Choose a smaller one.")
    try:
        jpeg = _normalise_photo(data)
    except ValueError:
        raise HTTPException(415, "That file is not a photo we can read. Use a JPEG, PNG or WebP image.")
    version = hashlib.sha256(jpeg).hexdigest()[:12]
    key = f"avatars/{u.id}/{version}.jpg"
    get_storage().put(key, jpeg)
    u.photo_key = key
    u.picture = f"/api/profile/photo/{u.id}?v={version}"  # a new address per photo, so browsers never show a stale one
    await session.commit()
    return _out(u)


@router.delete("/photo", response_model=ProfileOut)
async def remove_photo(p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    u = await _me(p, session)
    u.photo_key, u.picture = None, None  # the next Google sign-in brings back the Google photo, if there is one
    await session.commit()
    return _out(u)


@router.get("/photo/{user_id}")
async def photo(user_id: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    """The uploaded photo, for its owner and for admins. 404 for everyone else."""
    if not (p.is_admin or p.user_id == user_id):
        raise HTTPException(404, "not found")
    u = await session.get(User, user_id)
    if u is None or not u.photo_key:
        raise HTTPException(404, "not found")
    try:
        data = get_storage().get(u.photo_key)
    except Exception:
        raise HTTPException(404, "not found")
    # the URL changes with every new photo (?v=), so it can be cached for a long time
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.post("/password", response_model=ProfileOut)
async def change_password(body: PasswordIn, response: Response, p: Principal = Depends(get_principal),
                          session: AsyncSession = Depends(get_session)):
    """Change the password (the current one is required), or set a first one on a Google-only account. Every other
    signed-in session of this account is signed out; this one gets fresh tokens."""
    from app.api.auth import _issue  # late import: auth must not depend on this module

    u = await _me(p, session)
    if u.password_hash and not check_password(body.current_password or "", u.password_hash):
        raise HTTPException(400, "Your current password is not right.")
    if body.new_password.strip().lower() == u.email.lower():
        raise HTTPException(422, "Choose a password that is not your email address.")
    u.password_hash = hash_password(body.new_password)
    for t in (await session.execute(select(RefreshToken).where(RefreshToken.user_id == u.id,
                                                                RefreshToken.revoked.is_(False)))).scalars():
        t.revoked = True
    await _issue(session, u, response)  # commits; fresh cookies for this browser
    return _out(u)
