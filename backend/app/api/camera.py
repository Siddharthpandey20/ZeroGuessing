"""Camera input (plan K.1): photo -> editable text; 'check this clause' against the loaded documents.
A photo is never ingested as a document (no reliable page/bbox mapping -> no exact citations)."""

from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from rapidfuzz import fuzz
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contradictions import alert_view
from app.core.access import charge
from app.core.retrieve import retrieve
from app.core.sanitize import clean_ai_text
from app.db import get_session
from app.llm.gemini import get_llm
from app.models import Contradiction, Sentence
from app.security import Principal, get_principal

router = APIRouter(tags=["camera"])
_MIME = {"image/png", "image/jpeg", "image/webp"}


@router.post("/camera/transcribe")
async def transcribe(image: UploadFile = File(...), p: Principal = Depends(get_principal),
                     session: AsyncSession = Depends(get_session)):
    if image.content_type not in _MIME:
        raise HTTPException(415, "send a PNG, JPEG or WebP image")
    data = await image.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(413, "image too large")
    await charge(session, p, "camera")  # S6: a model call per photo, 429 past the daily limit
    await session.commit()
    # S5: what the photo says, so contacts stay; markup and invisible characters go. The user edits it before use.
    text = clean_ai_text(await get_llm().read_image(data, image.content_type), None, max_len=4000)
    return {"text": text, "note": "Check and edit the text before sending it; reading errors must not become the question."}


class CheckIn(BaseModel):
    text: str = Field(min_length=10, max_length=4000)
    as_of: date | None = None
    chat_id: str | None = Field(None, description="check against this chat's documents (required for signed-in users)")


@router.post("/camera/check-clause")
async def check_clause(body: CheckIn, session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    from app.api.chats import _chat, _scope  # late import: chats imports documents, which must not import camera

    as_of = body.as_of or date.today()
    doc_ids = None  # service credentials: every document
    if p.kind == "user" or body.chat_id:  # people only ever see their own chat's documents
        if not body.chat_id:
            raise HTTPException(422, "chat_id is required")
        doc_ids = await _scope(session, await _chat(session, body.chat_id, p))
    r = await retrieve(session, body.text, as_of, doc_ids=doc_ids, viewer=p.user_id)
    scored = sorted(((fuzz.token_set_ratio(body.text.lower(), e.text.lower()), e) for e in r.evidence),
                    key=lambda x: x[0], reverse=True)
    if not scored or scored[0][0] < 90:
        return {"found": False, "best_score": scored[0][0] if scored else 0,
                "closest": [e.citation() for _, e in scored[:3]],
                "message": "Not found in any loaded document: I don't have proof this clause applies."}
    score, e = scored[0]
    contras = (await session.execute(select(Contradiction).where(
        or_(Contradiction.sentence_a == e.sentence_id, Contradiction.sentence_b == e.sentence_id)))).scalars().all()
    if doc_ids is not None and contras:
        ids = {s for c in contras for s in (c.sentence_a, c.sentence_b)}
        doc_of = dict((await session.execute(select(Sentence.id, Sentence.document_id).where(Sentence.id.in_(ids)))).all())
        contras = [c for c in contras if doc_of.get(c.sentence_a) in doc_ids and doc_of.get(c.sentence_b) in doc_ids]
    return {"found": True, "score": score, "match": e.citation(), "status": e.status, "status_note": e.status_note,
            "conflicts": await alert_view(session, list(contras))}
