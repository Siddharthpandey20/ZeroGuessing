"""ORM tables. See docs/RESEARCH_AND_PLAN.md C.2 / K / L."""

import uuid
from datetime import date, datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    JSON,
    Boolean,
    Computed,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.config import get_settings
from app.db import Base

EMBED_DIM = get_settings().embed_dim


def _id() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    title: Mapped[str] = mapped_column(Text)
    filename: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    doc_type: Mapped[str] = mapped_column(String(32), default="other")
    issuer: Mapped[str | None] = mapped_column(Text, nullable=True)
    circular_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="upload")  # corpus|upload
    # the signed-in (non-admin) user whose chat upload first stored this file; None = the shared library: an admin or
    # service-key upload, or a demo document. A user's upload never changes the library's rules (S3).
    uploaded_by: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    storage_key: Mapped[str] = mapped_column(Text)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ingest_status: Mapped[str] = mapped_column(String(24), default="queued")  # queued|parsing|embedding|indexed|failed
    ingest_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # text left out when the PDF was read (S2): spans a reader can't see (white-on-white, invisible, transparent,
    # microscopic, covered) and sentences that read as instructions to an AI ("ignore previous instructions...")
    hidden_text_ignored: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    suspicious_text_ignored: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Clause(Base):
    __tablename__ = "clauses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    clause_ref: Mapped[str] = mapped_column(Text)  # '7.2', '7.2A', '7.2(b)', 'Annex 3', '_p3' (unnumbered)
    heading_path: Mapped[str] = mapped_column(Text, default="")
    parent_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_start: Mapped[int] = mapped_column(Integer)
    page_end: Mapped[int] = mapped_column(Integer)
    ord: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)


class Sentence(Base):
    __tablename__ = "sentences"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    clause_id: Mapped[str] = mapped_column(ForeignKey("clauses.id", ondelete="CASCADE"), index=True)
    page: Mapped[int] = mapped_column(Integer)  # 1-based
    ord: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    bboxes: Mapped[list] = mapped_column(JSON, default=list)  # [[x0,y0,x1,y1], ...] PDF points
    is_table_row: Mapped[bool] = mapped_column(Boolean, default=False)
    values: Mapped[list] = mapped_column(JSON, default=list)  # normalised typed values


class Chunk(Base):
    __tablename__ = "chunks"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    clause_id: Mapped[str] = mapped_column(ForeignKey("clauses.id", ondelete="CASCADE"), index=True)
    sentence_ids: Mapped[list] = mapped_column(JSON)
    text: Mapped[str] = mapped_column(Text)  # heading path + body, what gets embedded/searched
    embedding = mapped_column(Vector(EMBED_DIM), nullable=True)
    tsv = mapped_column(TSVECTOR, Computed("to_tsvector('simple', text)", persisted=True))

    __table_args__ = (Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),)


class Amendment(Base):
    __tablename__ = "amendments"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    source_doc_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    source_sentence_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source_clause_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_doc_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), nullable=True)
    target_doc_ref: Mapped[str] = mapped_column(Text)  # as written in the circular
    target_clause_ref: Mapped[str] = mapped_column(Text)
    target_key: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)  # '<target_doc_id>:<clause_ref>'
    root_key: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)  # '<root_doc_id>:<clause_ref>'
    via_amendment_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    action: Mapped[str] = mapped_column(String(24))  # substitute|insert|delete|withdraw_document
    new_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    trigger_phrase: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(16), default="proposed")  # proposed|confirmed|rejected
    # why it was not applied automatically (S3): a person has to confirm it. None = it passed every check.
    review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class PairCheck(Base):
    """Every sentence pair the contradiction model has already judged, conflicting or not, so the same pair is never
    sent to the model twice (an upload's scan does the work once; questions then reuse the verdict). Sentences get new
    ids when a document is re-read, so the cascade retires stale verdicts by itself."""
    __tablename__ = "pair_checks"
    sentence_a: Mapped[str] = mapped_column(ForeignKey("sentences.id", ondelete="CASCADE"), primary_key=True)
    sentence_b: Mapped[str] = mapped_column(ForeignKey("sentences.id", ondelete="CASCADE"), primary_key=True)
    conflict: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Contradiction(Base):
    __tablename__ = "contradictions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    sentence_a: Mapped[str] = mapped_column(ForeignKey("sentences.id", ondelete="CASCADE"))
    sentence_b: Mapped[str] = mapped_column(ForeignKey("sentences.id", ondelete="CASCADE"))
    subject: Mapped[str] = mapped_column(Text)
    attribute: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_a: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_b: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(16))  # number|date|rule|eligibility
    scope: Mapped[str] = mapped_column(String(8))  # intra|cross
    source: Mapped[str] = mapped_column(String(8))  # query|scan
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    picture: Mapped[str | None] = mapped_column(Text, nullable=True)  # Google's photo URL, or our /api/profile/photo/...
    job_title: Mapped[str | None] = mapped_column(Text, nullable=True)
    organisation: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_key: Mapped[str | None] = mapped_column(Text, nullable=True)  # storage key of an uploaded profile photo
    role: Mapped[str] = mapped_column(String(16), default="viewer")  # admin|viewer
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_sub: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # jti
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Chat(Base):
    __tablename__ = "chats"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(Text, default="New chat")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # the last message of the branch on screen; the conversation is the path from it up through parent_id
    current_message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)


class ChatDocument(Base):
    """Documents a chat answers from. A file uploaded to two chats is stored and ingested once (sha256), linked twice."""
    __tablename__ = "chat_documents"
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True, index=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"), index=True)
    turn: Mapped[int] = mapped_column(Integer)  # depth in the conversation, 1-based
    version: Mapped[int] = mapped_column(Integer, default=1)  # among siblings (same parent): 1 of n, 2 of n...
    # the message this one follows (ChatGPT-style branches: editing a question adds a sibling, later turns hang
    # off whichever version they followed, so switching versions brings back that branch's follow-ups)
    parent_id: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    question: Mapped[str] = mapped_column(Text)
    input_mode: Mapped[str] = mapped_column(String(8), default="typed")  # typed|camera|voice
    reply_lang: Mapped[str | None] = mapped_column(String(4), nullable=True)  # hi|hne picked by the user; None = auto
    as_of: Mapped[date] = mapped_column(Date)
    answer: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|done|failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Share(Base):
    __tablename__ = "shares"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    chat_id: Mapped[str] = mapped_column(ForeignKey("chats.id", ondelete="CASCADE"))
    snapshot: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    view_count: Mapped[int] = mapped_column(Integer, default=0)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    kind: Mapped[str] = mapped_column(String(24))  # ingest|scan
    document_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|done|failed
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AnswerCache(Base):
    __tablename__ = "answer_cache"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    answer: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Report(Base):
    """The register of signed reports: what was issued, its fingerprint and signature (see app/core/reports.py)."""
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)  # ZG-XXXX-XXXX
    share_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    payload: Mapped[dict] = mapped_column(JSON)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    signature: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class UsageEvent(Base):
    """One metered action by a signed-in user (S6): kind = question | camera | upload. Counted per UTC day; kept when
    a chat is deleted, so deleting chats doesn't reset the day's allowance."""
    __tablename__ = "usage_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)


class AmendmentDecision(Base):
    """A signed-in user's own confirm / reject of an amendment (S3). It changes that user's answers only: the
    amendment's `status` is the shared one (set automatically, or by an admin), which other users keep seeing."""
    __tablename__ = "amendment_decisions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    amendment_id: Mapped[str] = mapped_column(ForeignKey("amendments.id", ondelete="CASCADE"), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))  # confirmed|rejected
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
