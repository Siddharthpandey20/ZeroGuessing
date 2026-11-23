"""Document Library API (plan K.3): upload, list with upload times + status, edit, disable, re-ingest, render."""

import hashlib
from dataclasses import dataclass
from datetime import date, datetime

import pymupdf
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.access import can_read, daily_limit, limit_message, readable_doc, sees_everything, used_today
from app.core.render import render_crop, render_page
from app.db import get_session
from app.ingest.pipeline import DuplicateDocument, create_document, needs_ingest, requeue, run_ingest
from app.models import Amendment, Chat, ChatDocument, Clause, Contradiction, Document, Job, Sentence
from app.security import Principal, get_principal, require_admin
from app.storage import get_storage

router = APIRouter(tags=["documents"])


class DocumentOut(BaseModel):
    id: str
    title: str
    filename: str
    doc_type: str
    issuer: str | None
    circular_no: str | None
    issue_date: date | None
    source: str
    file_size: int
    page_count: int
    uploaded_at: datetime
    ingested_at: datetime | None
    ingest_status: str
    ingest_error: str | None
    active: bool
    n_clauses: int = 0
    n_amendments_proposed: int = 0
    n_amendments_confirmed: int = 0
    n_alerts: int = 0
    hidden_text_ignored: int = 0
    suspicious_text_ignored: int = 0

    model_config = {"from_attributes": True}


class UploadResult(BaseModel):
    filename: str
    document_id: str | None
    job_id: str | None
    status: str  # queued | duplicate | rejected
    detail: str | None = None


class DocumentPatch(BaseModel):
    title: str | None = None
    doc_type: str | None = None
    issuer: str | None = None
    circular_no: str | None = None
    issue_date: date | None = None
    active: bool | None = None


@router.post("/documents", response_model=list[UploadResult], status_code=202, dependencies=[Depends(require_admin)])
async def upload_documents(
    bg: BackgroundTasks, files: list[UploadFile] = File(...), session: AsyncSession = Depends(get_session)
):
    return await store_uploads(session, bg, [(f.filename or "document.pdf", await f.read()) for f in files])


@dataclass
class Quota:
    """A signed-in user's allowance while their upload runs (S6). `held`: {document_id: file_size} of the PDFs in their
    chats, demo documents excluded. `uploads_left`: new PDFs they may still add today. `added`: new PDFs this request
    took (charged to the day once the upload is linked)."""
    held: dict[str, int]
    uploads_left: int
    added: int = 0

    def take(self, doc: Document) -> None:
        if doc.source == "corpus" or doc.id in self.held:
            return
        self.held[doc.id] = doc.file_size
        self.uploads_left -= 1
        self.added += 1


async def user_quota(session: AsyncSession, user_id: str) -> Quota:
    rows = await session.execute(
        select(Document.id, Document.file_size).join(ChatDocument, ChatDocument.document_id == Document.id)
        .join(Chat, Chat.id == ChatDocument.chat_id)
        .where(Chat.user_id == user_id, Document.source != "corpus").distinct())
    return Quota(dict(rows.all()), daily_limit("upload") - await used_today(session, user_id, "upload"))


async def _quota_refusal(session: AsyncSession, quota: Quota, data: bytes) -> str | None:
    """Why this file would take the user past their quota, or None. A file they already have, or a demo document,
    costs nothing."""
    s = get_settings()
    found = (await session.execute(select(Document.id, Document.source)
                                   .where(Document.sha256 == hashlib.sha256(data).hexdigest()))).first()
    if found and (found.id in quota.held or found.source == "corpus"):
        return None
    if quota.uploads_left <= 0:
        return limit_message("upload")
    if len(quota.held) >= s.max_user_documents:
        return f"upload limit reached: at most {s.max_user_documents} PDFs per user (remove one to add another)"
    used = sum(quota.held.values())
    if used + len(data) > s.max_user_upload_mb * 1024 * 1024:
        left = max(0.0, s.max_user_upload_mb - used / 1024 / 1024)
        return (f"storage limit reached: at most {s.max_user_upload_mb} MB of PDFs per user "
                f"({left:.1f} MB left, this file is {len(data) / 1024 / 1024:.1f} MB)")
    return None


def _page_refusal(data: bytes) -> str | None:
    """Unreadable, or more pages than one PDF may have (S6: parsing and embedding cost grow with pages)."""
    try:
        with pymupdf.open(stream=data, filetype="pdf") as pdf:
            pages = pdf.page_count
    except Exception:
        return "this file could not be read as a PDF"
    cap = get_settings().max_pdf_pages
    return f"too many pages: {pages} (at most {cap} pages per PDF)" if pages > cap else None


async def store_uploads(session: AsyncSession, bg: BackgroundTasks, items: list[tuple[str, bytes]],
                        source: str = "upload", quota: Quota | None = None) -> list[UploadResult]:
    """Validate, store and queue ingestion for each PDF. A file already stored (same sha256) is reported as a
    duplicate with its existing id, so a chat can link it without ingesting it twice.

    `quota` (from user_quota) turns on the per-user limits; it is updated in place as files are accepted, so a batch
    is admitted in order until a limit is hit and the rest are rejected."""
    limit = get_settings().max_upload_mb * 1024 * 1024
    out = []
    for name, data in items:
        if not data.startswith(b"%PDF"):
            out.append(UploadResult(filename=name, document_id=None, job_id=None, status="rejected", detail="not a PDF"))
            continue
        if len(data) > limit:
            out.append(UploadResult(filename=name, document_id=None, job_id=None, status="rejected", detail="file too large"))
            continue
        if refusal := _page_refusal(data):
            out.append(UploadResult(filename=name, document_id=None, job_id=None, status="rejected", detail=refusal))
            continue
        if quota is not None and (refusal := await _quota_refusal(session, quota, data)):
            out.append(UploadResult(filename=name, document_id=None, job_id=None, status="rejected", detail=refusal))
            continue
        try:
            doc, job = await create_document(session, data, name, source=source)
        except DuplicateDocument as d:
            job_id = None
            if needs_ingest(d.doc):  # stored before but its reading failed or was cut off by a restart: read it again
                job = await requeue(session, d.doc)
                bg.add_task(run_ingest, d.doc.id, job.id)
                job_id = job.id
            if quota is not None:
                quota.take(d.doc)
            out.append(UploadResult(filename=name, document_id=d.doc.id, job_id=job_id, status="duplicate"))
            continue
        if quota is not None:
            quota.take(doc)
        bg.add_task(run_ingest, doc.id, job.id)
        out.append(UploadResult(filename=name, document_id=doc.id, job_id=job.id, status="queued"))
    return out


async def _counts(session: AsyncSession) -> dict[str, dict[str, int]]:
    c: dict[str, dict[str, int]] = {}

    def add(doc_id: str, key: str, n: int) -> None:
        c.setdefault(doc_id, {})[key] = c.get(doc_id, {}).get(key, 0) + n

    for doc_id, n in await session.execute(select(Clause.document_id, func.count()).group_by(Clause.document_id)):
        add(doc_id, "n_clauses", n)
    for doc_id, st, n in await session.execute(
        select(Amendment.source_doc_id, Amendment.status, func.count()).group_by(Amendment.source_doc_id, Amendment.status)
    ):
        if st in ("proposed", "confirmed"):
            add(doc_id, f"n_amendments_{st}", n)
    sa = select(Sentence.document_id.label("d")).join(Contradiction, Contradiction.sentence_a == Sentence.id)
    sb = select(Sentence.document_id.label("d")).join(Contradiction, Contradiction.sentence_b == Sentence.id)
    for (doc_id,) in await session.execute(sa.union_all(sb)):
        add(doc_id, "n_alerts", 1)
    return c


@router.get("/documents", response_model=list[DocumentOut])
async def list_documents(
    doc_type: str | None = None, q: str | None = None, session: AsyncSession = Depends(get_session),
    p: Principal = Depends(get_principal),
):
    stmt = select(Document).order_by(Document.uploaded_at.desc())
    if not p.is_admin:  # a viewer sees the documents in their own chats, not everyone's uploads
        mine = select(ChatDocument.document_id).join(Chat, Chat.id == ChatDocument.chat_id).where(Chat.user_id == p.user_id)
        stmt = stmt.where(Document.id.in_(mine))
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if q:
        stmt = stmt.where(Document.title.ilike(f"%{q}%"))
    docs = (await session.execute(stmt)).scalars().all()
    counts = await _counts(session)
    return [DocumentOut.model_validate(d).model_copy(update=counts.get(d.id, {})) for d in docs]


async def _get_doc(session: AsyncSession, doc_id: str) -> Document:
    doc = await session.get(Document, doc_id)
    if doc is None:
        raise HTTPException(404, "document not found")
    return doc


@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    doc = await readable_doc(session, p, doc_id)
    clauses = (await session.execute(select(Clause).where(Clause.document_id == doc_id).order_by(Clause.ord))).scalars().all()
    counts = (await _counts(session)).get(doc_id, {})
    return {
        "document": DocumentOut.model_validate(doc).model_copy(update=counts),
        "clauses": [
            {"id": c.id, "ref": c.clause_ref, "heading_path": c.heading_path, "page_start": c.page_start,
             "page_end": c.page_end, "text": c.text[:400]}
            for c in clauses
        ],
    }


@router.patch("/documents/{doc_id}", response_model=DocumentOut, dependencies=[Depends(require_admin)])
async def patch_document(doc_id: str, patch: DocumentPatch, session: AsyncSession = Depends(get_session)):
    doc = await _get_doc(session, doc_id)
    for k, v in patch.model_dump(exclude_unset=True).items():
        setattr(doc, k, v)
    await session.commit()
    return DocumentOut.model_validate(doc)


@router.post("/documents/{doc_id}/reingest", status_code=202, dependencies=[Depends(require_admin)])
async def reingest(doc_id: str, bg: BackgroundTasks, session: AsyncSession = Depends(get_session)):
    doc = await _get_doc(session, doc_id)
    job = await requeue(session, doc)
    bg.add_task(run_ingest, doc.id, job.id)
    return {"job_id": job.id}


@router.get("/documents/{doc_id}/file")
async def get_file(doc_id: str, session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    doc = await readable_doc(session, p, doc_id)
    return Response(get_storage().get(doc.storage_key), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc.filename}"'})


@router.get("/documents/{doc_id}/pages/{page_no}.png")
async def page_image(
    doc_id: str, page_no: int, highlight: str = Query("", description="comma-separated sentence ids"),
    dpi: int = Query(110, ge=50, le=200), session: AsyncSession = Depends(get_session),
    p: Principal = Depends(get_principal),
):
    doc = await readable_doc(session, p, doc_id)
    boxes: list[list[float]] = []
    ids = [s for s in highlight.split(",") if s]
    if ids:
        for s in (await session.execute(select(Sentence).where(Sentence.id.in_(ids), Sentence.document_id == doc_id))).scalars():
            boxes.extend(s.bboxes)
    try:
        png = render_page(get_storage().get(doc.storage_key), page_no, boxes, dpi)
    except IndexError:
        raise HTTPException(404, "page not found")
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.get("/sentences/{sentence_id}/preview.png")
async def sentence_preview(sentence_id: str, session: AsyncSession = Depends(get_session),
                           p: Principal = Depends(get_principal)):
    s = await session.get(Sentence, sentence_id)
    if s is None or not s.bboxes or not await can_read(session, p, s.document_id):
        raise HTTPException(404, "sentence not found")
    doc = await _get_doc(session, s.document_id)
    png = render_crop(get_storage().get(doc.storage_key), s.bboxes)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    job = await session.get(Job, job_id)
    if job is None or not (sees_everything(p) or await can_read(session, p, job.document_id)):
        raise HTTPException(404, "job not found")
    return {"id": job.id, "kind": job.kind, "status": job.status, "document_id": job.document_id,
            "detail": job.detail, "created_at": job.created_at, "finished_at": job.finished_at}
