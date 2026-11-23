"""Who may see which document (S1), and the daily usage meter (S6).

A document belongs to the people whose chats it is in. Admins and the service key see every document; a signed-in
viewer sees only the documents linked to their own chats. Anything else answers 404, the same as a document that does
not exist, so a guessed id reveals nothing.
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import Select, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import Chat, ChatDocument, Document, UsageEvent
from app.security import Principal


def sees_everything(p: Principal) -> bool:
    return p.is_admin or p.user_id is None


def my_doc_ids(user_id: str) -> Select:
    """The ids of the documents in this user's chats (a subquery)."""
    return select(ChatDocument.document_id).join(Chat, Chat.id == ChatDocument.chat_id).where(Chat.user_id == user_id)


async def visible_doc_ids(session: AsyncSession, p: Principal) -> set[str] | None:
    """None = every document."""
    if sees_everything(p):
        return None
    return set((await session.execute(my_doc_ids(p.user_id))).scalars())


async def can_read(session: AsyncSession, p: Principal, doc_id: str | None) -> bool:
    if doc_id is None:
        return False
    if sees_everything(p):
        return True
    q = select(exists().where(ChatDocument.document_id == doc_id, ChatDocument.chat_id == Chat.id, Chat.user_id == p.user_id))
    return bool((await session.execute(q)).scalar())


async def readable_doc(session: AsyncSession, p: Principal, doc_id: str) -> Document:
    """The document, or 404 when it doesn't exist or isn't in one of this user's chats."""
    doc = await session.get(Document, doc_id)
    if doc is None or not await can_read(session, p, doc_id):
        raise HTTPException(404, "document not found")
    return doc


# ---------------------------------------------------------------- daily usage (S6)
_LIMITS = {"question": "max_daily_questions", "camera": "max_daily_camera", "upload": "max_daily_uploads"}
_WORDS = {"question": "questions", "camera": "photo readings", "upload": "PDF uploads"}


def _day_start() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


async def used_today(session: AsyncSession, user_id: str, kind: str) -> int:
    q = select(func.count()).select_from(UsageEvent).where(
        UsageEvent.user_id == user_id, UsageEvent.kind == kind, UsageEvent.created_at >= _day_start())
    return (await session.execute(q)).scalar_one()


def daily_limit(kind: str) -> int:
    return getattr(get_settings(), _LIMITS[kind])


def limit_message(kind: str) -> str:
    return f"daily limit reached: at most {daily_limit(kind)} {_WORDS[kind]} per day. It resets at 00:00 UTC."


async def charge(session: AsyncSession, p: Principal, kind: str, n: int = 1) -> None:
    """Count n uses of `kind` for this user today, or answer 429 when that would pass the daily limit. Admins and the
    service key are not metered. Committed by the caller's next commit."""
    if sees_everything(p):
        return
    if await used_today(session, p.user_id, kind) + n > daily_limit(kind):
        raise HTTPException(429, limit_message(kind))
    session.add_all(UsageEvent(user_id=p.user_id, kind=kind) for _ in range(n))
    await session.flush()
