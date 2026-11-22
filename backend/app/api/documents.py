"""Document Library API (plan K.3): upload, list with upload times + status, edit, disable, re-ingest, render."""

from datetime import date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.render import render_crop, render_page
from app.db import get_session
from app.ingest.pipeline import DuplicateDocument, create_document, run_ingest
from app.models import Amendment, Clause, Contradiction, Document, Job, Sentence
from app.security import require_admin
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
    limit = get_settings().max_upload_mb * 1024 * 1024
    out = []
    for f in files:
        data = await f.read()
        name = f.filename or "document.pdf"
        if not data.startswith(b"%PDF"):
            out.append(UploadResult(filename=name, document_id=None, job_id=None, status="rejected", detail="not a PDF"))
            continue
        if len(data) > limit:
            out.append(UploadResult(filename=name, document_id=None, job_id=None, status="rejected", detail="file too large"))
            continue
        try:
            doc, job = await create_document(session, data, name)
        except DuplicateDocument as d:
            out.append(UploadResult(filename=name, document_id=d.doc.id, job_id=None, status="duplicate"))
            continue
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
    doc_type: str | None = None, q: str | None = None, session: AsyncSession = Depends(get_session)
):
    stmt = select(Document).order_by(Document.uploaded_at.desc())
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
async def get_document(doc_id: str, session: AsyncSession = Depends(get_session)):
    doc = await _get_doc(session, doc_id)
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
    job = Job(kind="ingest", document_id=doc.id)
    doc.ingest_status = "queued"
    session.add(job)
    await session.commit()
    bg.add_task(run_ingest, doc.id, job.id)
    return {"job_id": job.id}


@router.get("/documents/{doc_id}/file")
async def get_file(doc_id: str, session: AsyncSession = Depends(get_session)):
    doc = await _get_doc(session, doc_id)
    return Response(get_storage().get(doc.storage_key), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{doc.filename}"'})


@router.get("/documents/{doc_id}/pages/{page_no}.png")
async def page_image(
    doc_id: str, page_no: int, highlight: str = Query("", description="comma-separated sentence ids"),
    dpi: int = Query(110, ge=50, le=200), session: AsyncSession = Depends(get_session),
):
    doc = await _get_doc(session, doc_id)
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
async def sentence_preview(sentence_id: str, session: AsyncSession = Depends(get_session)):
    s = await session.get(Sentence, sentence_id)
    if s is None or not s.bboxes:
        raise HTTPException(404, "sentence not found")
    doc = await _get_doc(session, s.document_id)
    png = render_crop(get_storage().get(doc.storage_key), s.bboxes)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, session: AsyncSession = Depends(get_session)):
    job = await session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "job not found")
    return {"id": job.id, "kind": job.kind, "status": job.status, "document_id": job.document_id,
            "detail": job.detail, "created_at": job.created_at, "finished_at": job.finished_at}
