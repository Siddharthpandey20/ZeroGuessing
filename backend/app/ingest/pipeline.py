"""Upload -> store -> parse -> clauses/sentences/chunks -> embeddings (-> amendment pass, step 7)."""

import asyncio
import hashlib
import logging
from datetime import date, datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.normalise import extract_values
from app.db import SessionLocal
from app.ingest.parse import PClause, parse_pdf
from app.models import Chunk, Clause, Document, Job, Sentence, _id
from app.storage import get_storage

log = logging.getLogger(__name__)
CHUNK_CHARS = 1200
TABLE_ROWS_PER_CHUNK = 8


class DuplicateDocument(Exception):
    def __init__(self, doc: Document):
        self.doc = doc


async def create_document(session: AsyncSession, data: bytes, filename: str, source: str = "upload") -> tuple[Document, Job]:
    sha = hashlib.sha256(data).hexdigest()
    existing = (await session.execute(select(Document).where(Document.sha256 == sha))).scalar_one_or_none()
    if existing:
        raise DuplicateDocument(existing)
    doc = Document(title=filename, filename=filename, sha256=sha, source=source, file_size=len(data),
                   storage_key=f"documents/{sha}.pdf")
    get_storage().put(doc.storage_key, data)
    session.add(doc)
    await session.flush()
    job = Job(kind="ingest", document_id=doc.id)
    session.add(job)
    await session.commit()
    RUNNING.add(doc.id)
    return doc, job


def _chunks(clause: PClause, sent_ids: list[str]) -> list[tuple[list[str], str]]:
    """Group a clause's sentences into chunks; table rows in groups (header is repeated in every row)."""
    out, ids, texts, size, rows = [], [], [], 0, 0
    for sid, s in zip(sent_ids, clause.sentences):
        limit_hit = size + len(s.text) > CHUNK_CHARS or (s.is_table_row and rows >= TABLE_ROWS_PER_CHUNK)
        if ids and limit_hit:
            out.append((ids, " ".join(texts)))
            ids, texts, size, rows = [], [], 0, 0
        ids.append(sid)
        texts.append(s.text)
        size += len(s.text)
        rows += int(s.is_table_row)
    if ids:
        out.append((ids, " ".join(texts)))
    return out


# documents this process has queued or is ingesting right now. Anything else that isn't indexed was cut off (server
# stopped or machine restarted mid-ingest) or failed, and is safe to queue again
RUNNING: set[str] = set()
DONE_STATES = ("indexed", "indexed_no_vectors")


def needs_ingest(doc: Document) -> bool:
    return doc.ingest_status not in DONE_STATES and doc.id not in RUNNING


async def requeue(session: AsyncSession, doc: Document) -> Job:
    job = Job(kind="ingest", document_id=doc.id)
    doc.ingest_status, doc.ingest_error = "queued", None
    session.add(job)
    await session.commit()
    RUNNING.add(doc.id)
    return job


async def resume_interrupted() -> None:
    """On startup: finish documents whose ingestion was interrupted by a shutdown or restart, one at a time."""
    async with SessionLocal() as session:
        docs = (await session.execute(select(Document).where(Document.ingest_status.in_(("queued", "parsing", "embedding")))
                                      .order_by(Document.uploaded_at))).scalars().all()
        jobs = [(d.id, (await requeue(session, d)).id) for d in docs]
    for doc_id, job_id in jobs:
        log.info("resuming interrupted ingest doc=%s", doc_id)
        await run_ingest(doc_id, job_id)


async def run_ingest(doc_id: str, job_id: str | None = None) -> None:
    RUNNING.add(doc_id)
    try:
        await _run_ingest(doc_id, job_id)
    finally:
        RUNNING.discard(doc_id)


async def _run_ingest(doc_id: str, job_id: str | None = None) -> None:
    async with SessionLocal() as session:
        doc = await session.get(Document, doc_id)
        job = await session.get(Job, job_id) if job_id else None
        if doc is None:
            return
        try:
            doc.ingest_status, doc.ingest_error = "parsing", None
            if job:
                job.status = "running"
            await session.commit()

            data = get_storage().get(doc.storage_key)
            parsed = await asyncio.to_thread(parse_pdf, data)
            # S2: what was left out is told to the user (documents list, chat documents panel)
            doc.hidden_text_ignored, doc.suspicious_text_ignored = parsed.hidden_ignored, parsed.suspicious_ignored
            if not parsed.clauses:
                if parsed.hidden_ignored or parsed.suspicious_ignored:
                    raise ValueError("No readable text was found in this PDF: all its text was hidden from view or "
                                     "written as instructions to an AI, and was ignored.")
                if parsed.unread_pages:
                    raise ValueError("This PDF is a scan (pages are images) and OCR is not installed on this server, "
                                     "so it can't be read. Install Tesseract, or upload a PDF with a text layer.")
                raise ValueError("No readable text was found in this PDF.")

            await session.execute(delete(Chunk).where(Chunk.document_id == doc.id))
            await session.execute(delete(Sentence).where(Sentence.document_id == doc.id))
            await session.execute(delete(Clause).where(Clause.document_id == doc.id))

            if doc.title == doc.filename:  # keep user edits on re-ingest
                doc.title = parsed.title
            doc.page_count = parsed.page_count
            doc.circular_no = doc.circular_no or parsed.circular_no
            doc.doc_type = doc.doc_type if doc.doc_type != "other" else parsed.doc_type
            if parsed.issue_date and not doc.issue_date:
                doc.issue_date = date.fromisoformat(parsed.issue_date)

            chunks: list[Chunk] = []
            for i, pc in enumerate(parsed.clauses):
                clause = Clause(document_id=doc.id, clause_ref=pc.ref, heading_path=pc.heading_path, parent_ref=pc.parent_ref,
                                page_start=pc.page_start, page_end=pc.page_end, ord=i, text=pc.text)
                session.add(clause)
                await session.flush()
                sids = []
                for j, ps in enumerate(pc.sentences):
                    s = Sentence(id=_id(), document_id=doc.id, clause_id=clause.id, page=ps.page, ord=j, text=ps.text,
                                 bboxes=ps.bboxes, is_table_row=ps.is_table_row,
                                 values=[v.to_dict() for v in extract_values(ps.text)])
                    session.add(s)
                    sids.append(s.id)
                ref = "" if pc.ref.startswith("_") else f"[{pc.ref}] "
                prefix = f"{doc.title} | {pc.heading_path} | {ref}".strip()
                for ids, body in _chunks(pc, sids):
                    chunks.append(Chunk(document_id=doc.id, clause_id=clause.id, sentence_ids=ids, text=f"{prefix}\n{body}"))
            session.add_all(chunks)
            doc.ingest_status = "embedding"
            await session.commit()

            try:
                from app.llm.gemini import get_llm

                vecs = await get_llm().embed([c.text for c in chunks])
                for c, v in zip(chunks, vecs):
                    c.embedding = v
                doc.ingest_status = "indexed"
            except Exception as e:  # keyword search still works without vectors
                log.exception("embedding failed doc=%s", doc.id)
                doc.ingest_status, doc.ingest_error = "indexed_no_vectors", f"embedding failed: {e}"

            await session.commit()

            # amendment pass + contradiction scan: failures here never fail ingestion (doc stays searchable)
            notes = []
            if parsed.ocr_pages:
                notes.append(f"ocr_pages={parsed.ocr_pages}")
            if parsed.unread_pages:
                notes.append(f"unread_scanned_pages={parsed.unread_pages}")
            if parsed.hidden_ignored or parsed.suspicious_ignored:
                notes.append(f"ignored hidden={parsed.hidden_ignored} suspicious={parsed.suspicious_ignored}")
            try:
                from app.core.amendments import extract_for_document, resolve_targets

                found = await extract_for_document(session, doc)
                await session.commit()
                notes.append(f"amendments={len(found)}")
                if linked := await resolve_targets(session):  # earlier circulars that amend this document
                    await session.commit()
                    notes.append(f"linked={linked}")
            except Exception as e:
                await session.rollback()
                log.exception("amendment pass failed doc=%s", doc_id)
                notes.append(f"amendment pass failed: {e}")
            try:
                from app.core.contradictions import scan_document

                notes.append(f"alerts={await scan_document(session, doc_id)}")
            except Exception as e:
                await session.rollback()
                log.exception("contradiction scan failed doc=%s", doc_id)
                notes.append(f"contradiction scan failed: {e}")

            doc = await session.get(Document, doc_id)
            doc.ingested_at = datetime.now(timezone.utc)
            if job_id and (job := await session.get(Job, job_id)):
                job.status, job.finished_at, job.detail = "done", doc.ingested_at, "; ".join(notes)
            await session.commit()
            log.info("ingested doc=%s clauses=%d chunks=%d", doc.id, len(parsed.clauses), len(chunks))
        except Exception as e:
            log.exception("ingest failed doc=%s", doc_id)
            await session.rollback()
            doc = await session.get(Document, doc_id)
            doc.ingest_status, doc.ingest_error = "failed", str(e)[:2000]
            if job_id and (job := await session.get(Job, job_id)):
                job.status, job.detail, job.finished_at = "failed", str(e)[:2000], datetime.now(timezone.utc)
            await session.commit()
