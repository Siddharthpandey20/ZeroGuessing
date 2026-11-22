"""Proactive contradiction alerts (side-by-side quotes) and on-demand rescans."""

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contradictions import alert_view, scan_document
from app.db import SessionLocal, get_session
from app.models import Contradiction, Document

router = APIRouter(tags=["alerts"])


@router.get("/alerts")
async def list_alerts(session: AsyncSession = Depends(get_session)):
    contras = (await session.execute(select(Contradiction).order_by(Contradiction.created_at.desc()))).scalars().all()
    return await alert_view(session, list(contras))


async def _scan_all() -> None:
    async with SessionLocal() as session:
        for d in (await session.execute(select(Document).where(Document.active.is_(True)))).scalars().all():
            await scan_document(session, d.id)


@router.post("/alerts/scan", status_code=202)
async def rescan(bg: BackgroundTasks):
    bg.add_task(_scan_all)
    return {"status": "scanning"}


@router.delete("/alerts/{alert_id}", status_code=204)
async def dismiss(alert_id: str, session: AsyncSession = Depends(get_session)):
    c = await session.get(Contradiction, alert_id)
    if c:
        await session.delete(c)
        await session.commit()
