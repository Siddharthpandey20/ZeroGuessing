"""Amendment confirm/edit table (human-in-the-loop) and clause timelines (plan Q7, K.3)."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.amendments import clause_status, clean_ref, relink
from app.db import get_session
from app.models import Amendment, Document

router = APIRouter(tags=["amendments"])


class AmendmentIn(BaseModel):
    source_doc_id: str
    source_clause_ref: str
    target_doc_id: str
    target_clause_ref: str
    action: str
    new_text: str | None = None
    effective_date: date | None = None
    status: str = "confirmed"


class AmendmentPatch(BaseModel):
    target_doc_id: str | None = None
    target_clause_ref: str | None = None
    action: str | None = None
    new_text: str | None = None
    effective_date: date | None = None
    status: str | None = None  # proposed|confirmed|rejected


def _out(a: Amendment, titles: dict[str, str]) -> dict:
    return {"id": a.id, "source_doc_id": a.source_doc_id, "source_doc_title": titles.get(a.source_doc_id),
            "source_clause_ref": a.source_clause_ref, "source_sentence_id": a.source_sentence_id,
            "target_doc_id": a.target_doc_id, "target_doc_title": titles.get(a.target_doc_id or ""),
            "target_doc_ref": a.target_doc_ref, "target_clause_ref": a.target_clause_ref, "root_key": a.root_key,
            "via_amendment_id": a.via_amendment_id, "action": a.action, "new_text": a.new_text,
            "old_value": a.old_value, "new_value": a.new_value, "issue_date": a.issue_date,
            "effective_date": a.effective_date, "trigger_phrase": a.trigger_phrase, "confidence": a.confidence,
            "status": a.status}


async def _titles(session: AsyncSession) -> dict[str, str]:
    return {d.id: d.title for d in (await session.execute(select(Document))).scalars()}


@router.get("/amendments")
async def list_amendments(status: str | None = None, session: AsyncSession = Depends(get_session)):
    q = select(Amendment).order_by(Amendment.effective_date.nulls_last(), Amendment.created_at)
    if status:
        q = q.where(Amendment.status == status)
    titles = await _titles(session)
    return [_out(a, titles) for a in (await session.execute(q)).scalars()]


@router.post("/amendments", status_code=201)
async def add_amendment(body: AmendmentIn, session: AsyncSession = Depends(get_session)):
    src = await session.get(Document, body.source_doc_id)
    tgt = await session.get(Document, body.target_doc_id)
    if not src or not tgt:
        raise HTTPException(404, "document not found")
    a = Amendment(source_doc_id=src.id, source_clause_ref=clean_ref(body.source_clause_ref), target_doc_id=tgt.id,
                  target_doc_ref=tgt.title, target_clause_ref=clean_ref(body.target_clause_ref), action=body.action,
                  new_text=body.new_text, issue_date=src.issue_date, effective_date=body.effective_date or src.issue_date,
                  confidence=1.0, status=body.status, trigger_phrase="manual")
    session.add(a)
    await session.flush()
    await relink(session)
    await session.commit()
    return _out(a, await _titles(session))


@router.patch("/amendments/{amend_id}")
async def patch_amendment(amend_id: str, body: AmendmentPatch, session: AsyncSession = Depends(get_session)):
    a = await session.get(Amendment, amend_id)
    if a is None:
        raise HTTPException(404, "amendment not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(a, k, clean_ref(v) if k == "target_clause_ref" and v else v)
    await relink(session)
    await session.commit()
    return _out(a, await _titles(session))


@router.get("/documents/{doc_id}/clauses/{clause_ref}/timeline")
async def timeline(doc_id: str, clause_ref: str, as_of: date | None = None, session: AsyncSession = Depends(get_session)):
    st = await clause_status(session, doc_id, clause_ref, as_of or date.today())
    return {"key": st.key, "state": st.state, "note": st.note, "current_text": st.current_text,
            "current_source": st.current_source, "history": st.history, "pending": st.pending}
