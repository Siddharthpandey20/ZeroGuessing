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
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_lang varchar(4)",
    "CREATE INDEX IF NOT EXISTS ix_messages_parent_id ON messages (parent_id)",
    "ALTER TABLE chats ADD COLUMN IF NOT EXISTS current_message_id varchar(32)",
    # profile details and an uploaded profile photo
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation text",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_key text",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS hidden_text_ignored integer NOT NULL DEFAULT 0",
    "ALTER TABLE documents ADD COLUMN IF NOT EXISTS suspicious_text_ignored integer NOT NULL DEFAULT 0",
    "ALTER TABLE amendments ADD COLUMN IF NOT EXISTS review_reason text",
    # S3 provenance. Added once, with a one-time guess for existing files: a file linked to a non-admin user's chat
    # within 10 minutes of being stored was that user's chat upload (a library file is linked, if ever, much later).
    """DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'documents' AND column_name = 'uploaded_by') THEN
           ALTER TABLE documents ADD COLUMN uploaded_by varchar(32);
           CREATE INDEX IF NOT EXISTS ix_documents_uploaded_by ON documents (uploaded_by);
           UPDATE documents d SET uploaded_by = (
             SELECT c.user_id FROM chat_documents cd JOIN chats c ON c.id = cd.chat_id JOIN users u ON u.id = c.user_id
             WHERE cd.document_id = d.id AND u.role <> 'admin' AND cd.added_at <= d.uploaded_at + interval '10 minutes'
             ORDER BY cd.added_at LIMIT 1)
           WHERE d.source = 'upload';
         END IF;
       END $$""",
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
