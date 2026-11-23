"""Chats with versioned turns (plan K.2): ask (SSE or JSON), edit & resend, regenerate, history."""

import asyncio
import json
import logging
import re
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.api.documents import UploadResult, store_uploads
from app.core.answer import answer_question
from app.db import SessionLocal, get_session
from app.llm.gemini import get_llm
from app.models import Chat, ChatDocument, Document, Message, _id
from app.security import Principal, get_principal

router = APIRouter(tags=["chats"])
log = logging.getLogger(__name__)
CORPUS_DIR = Path(__file__).resolve().parents[2] / "corpus" / "pdf"


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    as_of: date | None = None
    input_mode: str = Field("typed", pattern="^(typed|camera|voice)$")
    # answer language picked in the composer: hi = Hindi, hne = Chhattisgarhi; None/en follows the question's script
    reply_lang: str | None = Field(None, pattern="^(en|hi|hne)$")


class ChatIn(BaseModel):
    title: str | None = None


class ChatPatch(BaseModel):
    title: str = Field(min_length=1, max_length=60)


class ChatTitle(BaseModel):
    title: str = Field(description="2 to 5 words naming the topic, Title Case, no trailing punctuation")


_POLITE = re.compile(r"^(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:tell\s+me\s+|explain\s+|check\s+|show\s+me\s+)?", re.I)
_WH = re.compile(
    r"^(?:(?:what|which|how\s+(?:much|many|long)|when|where|who|why)(?:'s|\s+is|\s+are|\s+does|\s+do|\s+was|\s+were)?\s+)?"
    r"(?:the\s+|a\s+|an\s+)?", re.I)
_PREPS = {"to", "of", "on", "in", "for", "under", "with", "by", "at", "from", "about"}
_TAIL_STOP = {"a", "an", "the", "to", "of", "on", "in", "for", "under", "with", "by", "at", "and", "or", "is", "are", "today", "now", "me"}


def short_title(question: str, max_words: int = 5) -> str:
    """A chat's instant name from its first question: 'What is the EMI on the home loan?' -> 'EMI on the home loan'.
    Replaced by a model-written name a moment later unless the user renamed the chat first."""
    q = re.sub(r"\s+", " ", question).strip().rstrip("?.! ")
    core = _WH.sub("", _POLITE.sub("", q, count=1), count=1) or q
    all_words = core.split(" ")
    words = all_words[:max_words]
    # cut mid-phrase ("penalty on a floating-rate | home loan")? back off to before the last preposition
    if len(all_words) > max_words and all_words[max_words].lower() not in _TAIL_STOP:
        preps = [i for i, w in enumerate(words) if i >= 2 and w.lower() in _PREPS]
        if preps:
            words = words[: preps[-1]]
    while len(words) > 1 and words[-1].lower() in _TAIL_STOP:
        words.pop()
    t = " ".join(words).strip(" ,;:")
    return (t[:1].upper() + t[1:])[:60] or "New chat"


_bg_tasks: set[asyncio.Task] = set()


async def _auto_title(chat_id: str, question: str, placeholder: str) -> None:
    try:
        name = (await asyncio.wait_for(get_llm().generate_json(
            ChatTitle, question, "Name a chat about this question in 2 to 5 words, Title Case. No quotes, no punctuation at the end."),
            timeout=12)).title.strip().strip("\"'.").strip()
    except Exception as e:  # fake model, no key, or a slow model: the instant name stays
        log.info("auto title skipped: %s", e)
        return
    if not name or len(name) > 60:
        return
    async with SessionLocal() as session:
        chat = await session.get(Chat, chat_id)
        if chat is not None and chat.title == placeholder:  # never overwrite a name the user chose
            chat.title = name
            await session.commit()


async def _scope(session: AsyncSession, chat: Chat) -> list[str] | None:
    """The documents this chat answers from. Chats made with the service key (eval, scripts) search everything."""
    if chat.user_id is None:
        return None
    return list((await session.execute(select(ChatDocument.document_id).where(ChatDocument.chat_id == chat.id))).scalars())


def _msg(m: Message) -> dict:
    return {"id": m.id, "turn": m.turn, "version": m.version, "question": m.question, "as_of": m.as_of.isoformat(),
            "input_mode": m.input_mode, "reply_lang": m.reply_lang, "status": m.status, "answer": m.answer, "created_at": m.created_at.isoformat()}


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
    return await _detail(session, await _chat(session, chat_id, p))


async def _messages(session: AsyncSession, chat_id: str) -> list[Message]:
    return list((await session.execute(select(Message).where(Message.chat_id == chat_id)
                                       .order_by(Message.turn, Message.version))).scalars())


def _path(msgs: list[Message], current_id: str | None) -> list[Message]:
    """The conversation on screen: from the chat's current message up to turn 1."""
    by_id = {m.id: m for m in msgs}
    m = by_id.get(current_id) if current_id else None
    if m is None and msgs:  # no pointer (or it was lost): the newest message
        m = max(msgs, key=lambda x: (x.turn, x.version))
    out, seen = [], set()
    while m is not None and m.id not in seen:
        seen.add(m.id)
        out.append(m)
        m = by_id.get(m.parent_id) if m.parent_id else None
    return out[::-1]


def _siblings(msgs: list[Message], m: Message) -> list[Message]:
    return sorted((x for x in msgs if x.turn == m.turn and x.parent_id == m.parent_id), key=lambda x: x.version)


def _leaf(msgs: list[Message], m: Message) -> Message:
    """Deepest message under m, following the most recently created child: where that branch was left."""
    children: dict[str, list[Message]] = {}
    for x in msgs:
        if x.parent_id:
            children.setdefault(x.parent_id, []).append(x)
    while children.get(m.id):
        m = max(children[m.id], key=lambda x: x.created_at)
    return m


async def _detail(session: AsyncSession, chat: Chat) -> dict:
    msgs = await _messages(session, chat.id)
    turns = []
    for m in _path(msgs, chat.current_message_id):
        sib = _siblings(msgs, m)
        # `latest` is the version on screen (kept under its old name for older clients)
        turns.append({"turn": m.turn, "versions": [_msg(x) for x in sib], "latest": m.version, "active": m.version})
    return {"id": chat.id, "title": chat.title, "turns": turns}


async def _on_path(session: AsyncSession, chat: Chat, turn: int) -> tuple[list[Message], Message]:
    msgs = await _messages(session, chat.id)
    path = _path(msgs, chat.current_message_id)
    if not 1 <= turn <= len(path):
        raise HTTPException(404, "turn not found")
    return msgs, path[turn - 1]


@router.delete("/chats/{chat_id}", status_code=204)
async def delete_chat(chat_id: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    await session.delete(await _chat(session, chat_id, p))
    await session.commit()


def _answer_text(a: dict | None) -> str:
    """What an earlier answer said, in a few sentences, for understanding a follow-up."""
    if not a:
        return ""
    if a.get("reply"):
        return a["reply"]
    said = [c["text"] for c in a.get("claims", []) if c.get("verdict") in ("supported", "conflicted")]
    return " ".join(said) or (a.get("abstention") or {}).get("message", "")


async def _history(session: AsyncSession, m: Message, keep: int = 3) -> list[dict]:
    """The finished turns this message follows on its own branch, oldest first."""
    out = []
    pid = m.parent_id
    while pid and len(out) < keep:
        prev = await session.get(Message, pid)
        if prev is None:
            break
        if prev.status == "done":
            out.append({"question": prev.question, "answer": _answer_text(prev.answer)})
        pid = prev.parent_id
    return out[::-1]


async def _run(msg_id: str, use_cache: bool = True):
    """Stream the pipeline for one stored message; persist the final answer. Uses its own session (SSE outlives request)."""
    async with SessionLocal() as session:
        m = await session.get(Message, msg_id)
        try:
            doc_ids = await _scope(session, await session.get(Chat, m.chat_id))
            history = await _history(session, m)
            async for ev in answer_question(session, m.question, m.as_of, use_cache=use_cache, doc_ids=doc_ids,
                                             history=history, reply_lang=m.reply_lang):
                if ev["type"] in ("answer", "answer_update"):  # an update follows an early answer once conflicts are checked
                    m.answer, m.status = ev["answer"], "done"
                    await session.commit()
                    yield {**ev, "message": _msg(m)}
                elif ev["type"] == "error":
                    m.status, m.answer = "failed", {"error": ev["message"]}
                    await session.commit()
                    yield ev
                else:
                    yield ev
        except asyncio.CancelledError:
            # Stop was pressed (the browser closed the stream): record it, so the turn is not left pending forever
            await asyncio.shield(_mark_stopped(msg_id))
            raise
        except Exception as e:
            await session.rollback()
            m = await session.get(Message, msg_id)
            m.status, m.answer = "failed", {"error": str(e)}
            await session.commit()
            yield {"type": "error", "message": str(e)}


async def _mark_stopped(msg_id: str) -> None:
    """A stopped answer is kept as a failed turn marked stopped (Run again answers it). One that had already
    arrived, with only its late conflict check still running, stays as it was."""
    async with SessionLocal() as s2:
        m = await s2.get(Message, msg_id)
        if m is not None and m.status == "pending":
            m.status, m.answer = "failed", {"error": "You stopped this answer before it finished.", "stopped": True}
            await s2.commit()


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


async def _new_message(session: AsyncSession, chat: Chat, turn: int, version: int, body: AskIn,
                       parent_id: str | None = None) -> Message:
    m = Message(id=_id(), chat_id=chat.id, turn=turn, version=version, question=body.question.strip(),
                as_of=body.as_of or date.today(), input_mode=body.input_mode, parent_id=parent_id,
                reply_lang=body.reply_lang if body.reply_lang in ("hi", "hne") else None)
    session.add(m)
    chat.current_message_id = m.id  # the new message's branch is the one on screen
    chat.updated_at = datetime.now(timezone.utc)
    placeholder = None
    if chat.title == "New chat" and turn == 1:
        chat.title = placeholder = short_title(body.question)
    await session.commit()
    if placeholder:
        task = asyncio.create_task(_auto_title(chat.id, body.question.strip(), placeholder))
        _bg_tasks.add(task)
        task.add_done_callback(_bg_tasks.discard)
    return m


@router.patch("/chats/{chat_id}")
async def rename_chat(chat_id: str, body: ChatPatch, p: Principal = Depends(get_principal),
                      session: AsyncSession = Depends(get_session)):
    chat = await _chat(session, chat_id, p)
    chat.title = re.sub(r"\s+", " ", body.title).strip() or chat.title
    await session.commit()
    return {"id": chat.id, "title": chat.title, "created_at": chat.created_at, "updated_at": chat.updated_at}


# ---------------------------------------------------------------- a chat's own documents
class ChatDocOut(BaseModel):
    id: str
    title: str
    filename: str
    page_count: int
    file_size: int
    ingest_status: str
    ingest_error: str | None
    added_at: datetime


async def _chat_docs(session: AsyncSession, chat_id: str) -> list[ChatDocOut]:
    rows = await session.execute(
        select(Document, ChatDocument.added_at).join(ChatDocument, ChatDocument.document_id == Document.id)
        .where(ChatDocument.chat_id == chat_id).order_by(ChatDocument.added_at))
    return [ChatDocOut(id=d.id, title=d.title, filename=d.filename, page_count=d.page_count, file_size=d.file_size,
                       ingest_status=d.ingest_status, ingest_error=d.ingest_error, added_at=at) for d, at in rows]


async def _link(session: AsyncSession, chat: Chat, results: list[UploadResult]) -> list[UploadResult]:
    for r in results:
        if r.document_id and await session.get(ChatDocument, (chat.id, r.document_id)) is None:
            session.add(ChatDocument(chat_id=chat.id, document_id=r.document_id))
    chat.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return results


@router.get("/chats/{chat_id}/documents", response_model=list[ChatDocOut])
async def list_chat_documents(chat_id: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    await _chat(session, chat_id, p)
    return await _chat_docs(session, chat_id)


@router.post("/chats/{chat_id}/documents", response_model=list[UploadResult], status_code=202)
async def upload_chat_documents(chat_id: str, bg: BackgroundTasks, files: list[UploadFile] = File(...),
                                p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    """Any signed-in user can add PDFs to their own chat; a file already stored is linked, not ingested again."""
    chat = await _chat(session, chat_id, p)
    results = await store_uploads(session, bg, [(f.filename or "document.pdf", await f.read()) for f in files])
    return await _link(session, chat, results)


@router.post("/chats/{chat_id}/documents/demo", response_model=list[UploadResult], status_code=202)
async def add_demo_documents(chat_id: str, bg: BackgroundTasks, p: Principal = Depends(get_principal),
                             session: AsyncSession = Depends(get_session)):
    """The 7 synthetic demo PDFs (backend/corpus/pdf), stored once and linked to this chat."""
    chat = await _chat(session, chat_id, p)
    files = sorted(CORPUS_DIR.glob("*.pdf"))
    if not files:
        raise HTTPException(404, "demo documents are not built on this server (uv run python -m scripts.build_corpus)")
    results = await store_uploads(session, bg, [(f.name, f.read_bytes()) for f in files], source="corpus")
    return await _link(session, chat, results)


@router.delete("/chats/{chat_id}/documents/{doc_id}", status_code=204)
async def remove_chat_document(chat_id: str, doc_id: str, p: Principal = Depends(get_principal),
                               session: AsyncSession = Depends(get_session)):
    """Unlinks the document from this chat. The stored file stays (other chats may use it)."""
    await _chat(session, chat_id, p)
    link = await session.get(ChatDocument, (chat_id, doc_id))
    if link is None:
        raise HTTPException(404, "document is not in this chat")
    await session.delete(link)
    await session.commit()


@router.post("/chats/{chat_id}/messages")
async def ask(chat_id: str, body: AskIn, stream: bool = Query(True), p: Principal = Depends(get_principal),
              session: AsyncSession = Depends(get_session)):
    """A new question at the end of the conversation on screen."""
    chat = await _chat(session, chat_id, p)
    path = _path(await _messages(session, chat_id), chat.current_message_id)
    last = path[-1] if path else None
    m = await _new_message(session, chat, (last.turn if last else 0) + 1, 1, body, last.id if last else None)
    return await _respond(m.id, stream)


async def _sibling(session: AsyncSession, chat: Chat, turn: int, body: AskIn) -> Message:
    msgs, cur = await _on_path(session, chat, turn)
    version = max(x.version for x in _siblings(msgs, cur)) + 1
    return await _new_message(session, chat, turn, version, body, cur.parent_id)


@router.put("/chats/{chat_id}/turns/{turn}")
async def edit_and_resend(chat_id: str, turn: int, body: AskIn, stream: bool = Query(True),
                          session: AsyncSession = Depends(get_session), p: Principal = Depends(get_principal)):
    """Edit a past question (and/or its as-of date), like ChatGPT: the new version of that turn starts a new branch, so
    the turns after it leave the screen. They stay with the old version: switching back to it brings them back."""
    chat = await _chat(session, chat_id, p)
    m = await _sibling(session, chat, turn, body)
    return await _respond(m.id, stream)


@router.post("/chats/{chat_id}/turns/{turn}/regenerate")
async def regenerate(chat_id: str, turn: int, stream: bool = Query(True), p: Principal = Depends(get_principal),
                     session: AsyncSession = Depends(get_session)):
    """Run a turn's question again as a new version (a new branch from that point, like an edit)."""
    chat = await _chat(session, chat_id, p)
    _, prev = await _on_path(session, chat, turn)
    m = await _sibling(session, chat, turn, AskIn(question=prev.question, as_of=prev.as_of, input_mode=prev.input_mode,
                                                      reply_lang=prev.reply_lang))
    return await _respond(m.id, stream, use_cache=False)  # regenerate = re-run, bypass the answer cache


class SelectIn(BaseModel):
    version: int = Field(ge=1)


@router.post("/chats/{chat_id}/turns/{turn}/select")
async def select_version(chat_id: str, turn: int, body: SelectIn, p: Principal = Depends(get_principal),
                         session: AsyncSession = Depends(get_session)):
    """The version switcher (< 1 of 2 >): show another version of a turn, with the follow-ups that came after it."""
    chat = await _chat(session, chat_id, p)
    msgs, cur = await _on_path(session, chat, turn)
    pick = next((x for x in _siblings(msgs, cur) if x.version == body.version), None)
    if pick is None:
        raise HTTPException(404, "version not found")
    chat.current_message_id = _leaf(msgs, pick).id
    await session.commit()
    return await _detail(session, chat)
