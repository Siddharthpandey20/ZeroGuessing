"""Chats with versioned turns (plan K.2): ask (SSE or JSON), edit & resend, regenerate, history."""

import json
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.core.answer import answer_question
from app.db import SessionLocal, get_session
from app.models import Chat, Message
from app.security import Principal, get_principal

router = APIRouter(tags=["chats"])


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    as_of: date | None = None
    input_mode: str = Field("typed", pattern="^(typed|camera|voice)$")


class ChatIn(BaseModel):
    title: str | None = None


def _msg(m: Message) -> dict:
    return {"id": m.id, "turn": m.turn, "version": m.version, "question": m.question, "as_of": m.as_of.isoformat(),
            "input_mode": m.input_mode, "status": m.status, "answer": m.answer, "created_at": m.created_at.isoformat()}


@router.post("/chats", status_code=201)
async def create_chat(body: ChatIn, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    chat = Chat(title=body.title or "New chat", user_id=p.user_id)
    session.add(chat)
    await session.commit()
    return {"id": chat.id, "title": chat.title, "created_at": chat.created_at}


@router.get("/chats")
async def list_chats(p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    q = select(Chat).order_by(Chat.updated_at.desc())
    if p.kind == "user":  # users see their own chats; service credentials see all
        q = q.where(Chat.user_id == p.user_id)
    chats = (await session.execute(q)).scalars().all()
    return [{"id": c.id, "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at} for c in chats]


async def _chat(session: AsyncSession, chat_id: str, p: Principal | None = None) -> Chat:
    chat = await session.get(Chat, chat_id)
    if chat is None or (p is not None and p.kind == "user" and chat.user_id != p.user_id):
        raise HTTPException(404, "chat not found")
    return chat


@router.get("/chats/{chat_id}")
async def get_chat(chat_id: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    chat = await _chat(session, chat_id, p)
    msgs = (await session.execute(select(Message).where(Message.chat_id == chat_id).order_by(Message.turn, Message.version))).scalars().all()
    turns: dict[int, list[dict]] = {}
    for m in msgs:
        turns.setdefault(m.turn, []).append(_msg(m))
    return {"id": chat.id, "title": chat.title,
            "turns": [{"turn": t, "versions": v, "latest": v[-1]["version"]} for t, v in sorted(turns.items())]}


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    await session.delete(await _chat(session, chat_id, p))
    await session.commit()


async def _run(msg_id: str, use_cache: bool = True):
    """Stream the pipeline for one stored message; persist the final answer. Uses its own session (SSE outlives request)."""
    async with SessionLocal() as session:
        m = await session.get(Message, msg_id)
        try:
            async for ev in answer_question(session, m.question, m.as_of, use_cache=use_cache):
                if ev["type"] == "answer":
                    m.answer, m.status = ev["answer"], "done"
                    await session.commit()
                    yield {**ev, "message": _msg(m)}
                elif ev["type"] == "error":
                    m.status, m.answer = "failed", {"error": ev["message"]}
                    await session.commit()
                    yield ev
                else:
                    yield ev
        except Exception as e:
            await session.rollback()
            m = await session.get(Message, msg_id)
            m.status, m.answer = "failed", {"error": str(e)}
            await session.commit()
            yield {"type": "error", "message": str(e)}


async def _respond(msg_id: str, stream: bool, use_cache: bool = True):
    if stream:
        async def gen():
            async for ev in _run(msg_id, use_cache):
                yield {"event": ev["type"], "data": json.dumps(ev, default=str, ensure_ascii=False)}
        return EventSourceResponse(gen())
    last = None
    async for ev in _run(msg_id, use_cache):
        last = ev
    if last and last["type"] == "error":
        raise HTTPException(502, last["message"])
    return last["message"]


async def _new_message(session: AsyncSession, chat: Chat, turn: int, version: int, body: AskIn) -> Message:
    m = Message(chat_id=chat.id, turn=turn, version=version, question=body.question.strip(),
                as_of=body.as_of or date.today(), input_mode=body.input_mode)
    session.add(m)
    chat.updated_at = datetime.now(timezone.utc)
    if chat.title == "New chat" and turn == 1:
        chat.title = body.question.strip()[:80]
    await session.commit()
    return m


@router.post("/chats/{chat_id}/messages")
async def ask(chat_id: str, body: AskIn, stream: bool = Query(True), p: Principal = Depends(get_principal),
              session: AsyncSession = Depends(get_session)):
    chat = await _chat(session, chat_id, p)
    last = (await session.execute(select(func.max(Message.turn)).where(Message.chat_id == chat_id))).scalar()
    m = await _new_message(session, chat, (last or 0) + 1, 1, body)
    return await _respond(m.id, stream)


@router.put("/chats/{chat_id}/turns/{turn}")
async def edit_and_resend(chat_id: str, turn: int, body: AskIn, stream: bool = Query(True),
                          session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    """Edit a past question (and/or its as-of date): creates a new version of that turn; old versions are kept."""
    chat = await _chat(session, chat_id, p)
    v = (await session.execute(select(func.max(Message.version)).where(Message.chat_id == chat_id, Message.turn == turn))).scalar()
    if v is None:
        raise HTTPException(404, "turn not found")
    m = await _new_message(session, chat, turn, v + 1, body)
    return await _respond(m.id, stream)


@router.post("/chats/{chat_id}/turns/{turn}/regenerate")
async def regenerate(chat_id: str, turn: int, stream: bool = Query(True), p: Principal = Depends(get_principal),
                     session: AsyncSession = Depends(get_session)):
    chat = await _chat(session, chat_id, p)
    prev = (await session.execute(select(Message).where(Message.chat_id == chat_id, Message.turn == turn)
                                  .order_by(Message.version.desc()).limit(1))).scalar_one_or_none()
    if prev is None:
        raise HTTPException(404, "turn not found")
    m = await _new_message(session, chat, turn, prev.version + 1,
                           AskIn(question=prev.question, as_of=prev.as_of, input_mode=prev.input_mode))
    return await _respond(m.id, stream, use_cache=False)  # regenerate = re-run, bypass the answer cache
