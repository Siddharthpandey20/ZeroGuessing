from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


MIGRATIONS = [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_id varchar(32)",
    "CREATE INDEX IF NOT EXISTS ix_messages_parent_id ON messages (parent_id)",
    "ALTER TABLE chats ADD COLUMN IF NOT EXISTS current_message_id varchar(32)",
    # older chats were linear: each turn follows the latest version of the turn before it
    """UPDATE messages m SET parent_id = (SELECT p.id FROM messages p WHERE p.chat_id = m.chat_id AND p.turn = m.turn - 1
                                         ORDER BY p.version DESC LIMIT 1)
       WHERE m.turn > 1 AND m.parent_id IS NULL""",
    """UPDATE chats c SET current_message_id = (SELECT m.id FROM messages m WHERE m.chat_id = c.id
                                                ORDER BY m.turn DESC, m.version DESC LIMIT 1)
       WHERE c.current_message_id IS NULL""",
]


async def init_db() -> None:
    """Create extension + tables. Alembic migrations replace this before multi-env deploys."""
    from app import models  # noqa: F401  (register tables)

    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        # additive migrations for databases created before these columns existed (no Alembic yet)
        for stmt in MIGRATIONS:
            await conn.execute(text(stmt))


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
