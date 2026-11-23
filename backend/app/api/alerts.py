"""Proactive contradiction alerts (side-by-side quotes) and on-demand rescans."""

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contradictions import alert_view, scan_document
from app.db import SessionLocal, get_session
from app.models import Chat, ChatDocument, Contradiction, Document, Sentence
from app.security import Principal, get_principal, require_admin

router = APIRouter(tags=["alerts"])


@router.get("/alerts")
async def list_alerts(session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    q = select(Contradiction).order_by(Contradiction.created_at.desc())
    if not p.is_admin:  # a viewer sees conflicts between documents in their own chats only
        mine = select(ChatDocument.document_id).join(Chat, Chat.id == ChatDocument.chat_id).where(Chat.user_id == p.user_id)
        in_mine = select(Sentence.id).where(Sentence.document_id.in_(mine))
        q = q.where(Contradiction.sentence_a.in_(in_mine), Contradiction.sentence_b.in_(in_mine))
    contras = (await session.execute(q)).scalars().all()
    return await alert_view(session, list(contras))


async def _scan_all() -> None:
    async with SessionLocal() as session:
        for d in (await session.execute(select(Document).where(Document.active.is_(True)))).scalars().all():
            await scan_document(session, d.id)


@router.post("/alerts/scan", status_code=202, dependencies=[Depends(require_admin)])
async def rescan(bg: BackgroundTasks):
    bg.add_task(_scan_all)
    return {"status": "scanning"}


@router.delete("/alerts/{alert_id}", status_code=204, dependencies=[Depends(require_admin)])
async def dismiss(alert_id: str, session: AsyncSession = Depends(get_session)):
    c = await session.get(Contradiction, alert_id)
    if c:
        await session.delete(c)
        await session.commit()
