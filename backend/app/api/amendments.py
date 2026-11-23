"""Amendment confirm/edit table (human-in-the-loop) and clause timelines (plan Q7, K.3).

S3: an amendment that failed an automatic check (unknown target, missing clause, issuer mismatch, low confidence)
waits as `proposed` with its `review_reason`. The people whose documents it touches decide: an admin for any, a
signed-in user for one whose amending and amended documents are both in their own chats. S1: a user sees only the
amendments made by, or made to, their own documents."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import readable_doc, visible_doc_ids
from app.core.amendments import clause_status, clean_ref, relink
from app.db import get_session
from app.models import Amendment, Document
from app.security import Principal, get_principal, require_admin

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


def _out(a: Amendment, titles: dict[str, str], mine: set[str] | None) -> dict:
    return {"id": a.id, "source_doc_id": a.source_doc_id, "source_doc_title": titles.get(a.source_doc_id),
            "source_clause_ref": a.source_clause_ref, "source_sentence_id": a.source_sentence_id,
            "target_doc_id": a.target_doc_id, "target_doc_title": titles.get(a.target_doc_id or ""),
            "target_doc_ref": a.target_doc_ref, "target_clause_ref": a.target_clause_ref, "root_key": a.root_key,
            "via_amendment_id": a.via_amendment_id, "action": a.action, "new_text": a.new_text,
            "old_value": a.old_value, "new_value": a.new_value, "issue_date": a.issue_date,
            "effective_date": a.effective_date, "trigger_phrase": a.trigger_phrase, "confidence": a.confidence,
            "status": a.status, "review_reason": a.review_reason, "can_decide": _can_decide(a, mine)}


def _can_decide(a: Amendment, mine: set[str] | None) -> bool:
    if mine is None:  # admin / service key
        return True
    return a.source_doc_id in mine and a.target_doc_id is not None and a.target_doc_id in mine


async def _titles(session: AsyncSession, mine: set[str] | None) -> dict[str, str]:
    q = select(Document.id, Document.title)
    if mine is not None:  # never name a document the user can't see
        q = q.where(Document.id.in_(mine))
    return dict((await session.execute(q)).all())


@router.get("/amendments")
async def list_amendments(status: str | None = None, session: AsyncSession = Depends(get_session),
                          p: Principal = Depends(get_principal)):
    mine = await visible_doc_ids(session, p)
    q = select(Amendment).order_by(Amendment.effective_date.nulls_last(), Amendment.created_at)
    if status:
        q = q.where(Amendment.status == status)
    if mine is not None:
        q = q.where(or_(Amendment.source_doc_id.in_(mine), Amendment.target_doc_id.in_(mine)))
    titles = await _titles(session, mine)
    return [_out(a, titles, mine) for a in (await session.execute(q)).scalars()]


@router.post("/amendments", status_code=201, dependencies=[Depends(require_admin)])
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
    return _out(a, await _titles(session, None), None)


@router.patch("/amendments/{amend_id}")
async def patch_amendment(amend_id: str, body: AmendmentPatch, session: AsyncSession = Depends(get_session),
                          p: Principal = Depends(get_principal)):
    """Admins edit any field. A signed-in user may only confirm or reject an amendment between two of their own
    documents (S3: 'ask the user to confirm')."""
    mine = await visible_doc_ids(session, p)
    a = await session.get(Amendment, amend_id)
    if a is None or (mine is not None and a.source_doc_id not in mine and a.target_doc_id not in mine):
        raise HTTPException(404, "amendment not found")
    changes = body.model_dump(exclude_unset=True)
    if mine is not None:
        if set(changes) != {"status"} or changes["status"] not in ("confirmed", "rejected"):
            raise HTTPException(403, "you can confirm or reject this amendment; only an admin can edit it")
        if not _can_decide(a, mine):
            raise HTTPException(403, "both the amending and the amended document must be in your chats")
    for k, v in changes.items():
        setattr(a, k, clean_ref(v) if k == "target_clause_ref" and v else v)
    await relink(session)
    await session.commit()
    return _out(a, await _titles(session, mine), mine)


@router.get("/documents/{doc_id}/clauses/{clause_ref}/timeline")
async def timeline(doc_id: str, clause_ref: str, as_of: date | None = None, session: AsyncSession = Depends(get_session),
                   p: Principal = Depends(get_principal)):
    await readable_doc(session, p, doc_id)  # S1
    mine = await visible_doc_ids(session, p)
    from app.core.amendments import _confirmed

    # a user's timeline counts only amendments issued by their own documents, as their answers do
    cache = await _confirmed(session, sorted(mine) if mine is not None else None)
    st = await clause_status(session, doc_id, clause_ref, as_of or date.today(), cache)
    return {"key": st.key, "state": st.state, "note": st.note, "current_text": st.current_text,
            "current_source": st.current_source, "history": st.history, "pending": st.pending}
