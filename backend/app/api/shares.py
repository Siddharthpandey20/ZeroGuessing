"""Shareable chats (plan K.4): frozen read-only snapshot behind an unguessable token + self-contained HTML export.
The public routes are the only unauthenticated ones besides /health."""

import base64
import html
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.render import render_crop
from app.db import get_session
from app.models import Chat, Document, Message, Sentence, Share
from app.security import Principal, get_principal
from app.storage import get_storage

router = APIRouter(tags=["shares"])
public = APIRouter(tags=["public"])


class ShareIn(BaseModel):
    turn: int | None = Field(None, description="share one turn only; default = whole chat")
    expires_days: int = Field(7, ge=1, le=90)
    include_crops: bool = True


async def _crops(session: AsyncSession, answers: list[dict]) -> dict[str, str]:
    ids = {c["sentence_id"] for a in answers for cl in a.get("claims", []) for c in cl.get("citations", [])}
    ids |= {side["sentence_id"] for a in answers for x in a.get("contradictions", []) for side in (x["a"], x["b"])}
    out: dict[str, str] = {}
    pdfs: dict[str, bytes] = {}
    for s in (await session.execute(select(Sentence).where(Sentence.id.in_(ids)))).scalars() if ids else []:
        if s.document_id not in pdfs:
            d = await session.get(Document, s.document_id)
            pdfs[s.document_id] = get_storage().get(d.storage_key)
        if s.bboxes:
            out[s.id] = base64.b64encode(render_crop(pdfs[s.document_id], s.bboxes, dpi=110)).decode()
    return out


@router.post("/chats/{chat_id}/shares", status_code=201)
async def create_share(chat_id: str, body: ShareIn, p: Principal = Depends(get_principal),
                       session: AsyncSession = Depends(get_session)):
    chat = await session.get(Chat, chat_id)
    if chat is None or (p.kind == "user" and chat.user_id != p.user_id):
        raise HTTPException(404, "chat not found")
    q = select(Message).where(Message.chat_id == chat_id, Message.status == "done").order_by(Message.turn, Message.version)
    if body.turn is not None:
        q = q.where(Message.turn == body.turn)
    msgs = (await session.execute(q)).scalars().all()
    latest: dict[int, Message] = {}
    for m in msgs:
        latest[m.turn] = m  # latest version of each turn
    if not latest:
        raise HTTPException(400, "nothing to share yet")
    answers = [m.answer for m in latest.values()]
    snapshot = {
        "title": chat.title, "frozen_at": datetime.now(timezone.utc).isoformat(),
        "turns": [{"turn": m.turn, "question": m.question, "as_of": m.as_of.isoformat(), "answer": m.answer} for m in latest.values()],
        "crops": await _crops(session, answers) if body.include_crops else {},
    }
    token = secrets.token_urlsafe(24)
    share = Share(token=token, chat_id=chat_id, snapshot=snapshot,
                  expires_at=datetime.now(timezone.utc) + timedelta(days=body.expires_days))
    session.add(share)
    await session.commit()
    return {"token": token, "path": f"/public/shares/{token}", "html_path": f"/public/shares/{token}/html",
            "expires_at": share.expires_at, "warning": "Anyone with this link can read the quoted passages in this chat."}


@router.get("/chats/{chat_id}/shares")
async def list_shares(chat_id: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    chat = await session.get(Chat, chat_id)
    if chat is None or (p.kind == "user" and chat.user_id != p.user_id):
        raise HTTPException(404, "chat not found")
    rows = (await session.execute(select(Share).where(Share.chat_id == chat_id).order_by(Share.created_at.desc()))).scalars()
    return [{"token": s.token, "created_at": s.created_at, "expires_at": s.expires_at, "revoked": s.revoked,
             "view_count": s.view_count} for s in rows]


@router.delete("/shares/{token}", status_code=204)
async def revoke(token: str, p: Principal = Depends(get_principal), session: AsyncSession = Depends(get_session)):
    s = await session.get(Share, token)
    chat = await session.get(Chat, s.chat_id) if s else None
    if s and chat and (p.kind != "user" or chat.user_id == p.user_id):
        s.revoked = True
        await session.commit()


async def _live(session: AsyncSession, token: str) -> Share:
    s = await session.get(Share, token)
    exp = s.expires_at.replace(tzinfo=s.expires_at.tzinfo or timezone.utc) if s else None
    if s is None or s.revoked or exp < datetime.now(timezone.utc):
        raise HTTPException(404, "This link is no longer available.")
    s.view_count += 1
    await session.commit()
    return s


@public.get("/public/shares/{token}")
async def view_share(token: str, session: AsyncSession = Depends(get_session)):
    return (await _live(session, token)).snapshot


@public.get("/public/shares/{token}/html", response_class=HTMLResponse)
async def export_html(token: str, session: AsyncSession = Depends(get_session)):
    return HTMLResponse(render_snapshot_html((await _live(session, token)).snapshot),
                        headers={"Content-Disposition": f'inline; filename="chat-{token[:8]}.html"'})


_CSS = """body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1a1a1a;background:#fff}
h1{font-size:20px}.banner{background:#f4f4f0;border:1px solid #ddd;padding:8px 12px;border-radius:6px;font-size:13px}
.q{font-weight:600;margin-top:28px}.claim{margin:6px 0}.blocked{color:#8a1c1c;text-decoration:line-through}
.reason{font-size:12px;color:#8a1c1c;margin-left:6px}.cite{display:inline-block;font-size:12px;background:#eef2ff;
border-radius:4px;padding:1px 6px;margin-left:4px;position:relative}.cite .tip{display:none;position:absolute;z-index:5;
left:0;top:20px;width:520px;background:#fff;border:1px solid #ccc;box-shadow:0 4px 16px #0002;padding:6px}
.cite:hover .tip{display:block}.cite img{max-width:100%}.score{font-size:13px;color:#444}
.conflict{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:1px solid #e0b000;border-radius:6px;padding:8px;margin:8px 0}
.abst{background:#fff7e6;border-left:3px solid #e0a000;padding:6px 10px}"""


def render_snapshot_html(snap: dict) -> str:
    e = html.escape
    crops = snap.get("crops", {})

    def cite(c: dict) -> str:
        img = f'<img src="data:image/png;base64,{crops[c["sentence_id"]]}">' if c["sentence_id"] in crops else ""
        return (f'<span class="cite">{e(c["doc_title"])} · {e(c["clause_ref"])} · p.{c["page"]}<span class="tip">{img}'
                f'<div>“{e(c["quote"])}”</div></span></span>')

    parts = [f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
             f"<title>{e(snap['title'])}</title><style>{_CSS}</style></head><body><h1>{e(snap['title'])}</h1>",
             f"<div class='banner'>Frozen on {e(snap['frozen_at'][:10])}. Read-only record of what the system answered and the "
             f"proof it showed. Documents may have changed since.</div>"]
    for t in snap["turns"]:
        a = t["answer"] or {}
        f = a.get("faithfulness") or {}
        parts.append(f"<div class='q'>Q{t['turn']}. {e(t['question'])} <span class='score'>(as of {e(t['as_of'])})</span></div>")
        parts.append(f"<div class='score'>Faithfulness: {f.get('supported', 0)}/{f.get('total', 0)} claims backed by a quote "
                     f"({f.get('pct', 0)}%), {f.get('blocked', 0)} blocked</div>")
        for cl in a.get("claims", []):
            ok = cl["verdict"] in ("supported", "conflicted")
            text = cl.get("text_hi") or cl["text"]
            reason = "" if ok else f"<span class='reason'>blocked: {e(cl.get('reason') or '')}</span>"
            parts.append(f"<div class='claim'><span class='{'' if ok else 'blocked'}'>{e(text)}</span>"
                         f"{''.join(cite(c) for c in cl['citations'])}{reason}</div>")
        for x in a.get("contradictions", []):
            parts.append(f"<div class='conflict'><div><b>{e(x['a']['doc_title'])} {e(x['a']['clause_ref'])}</b><br>“{e(x['a']['quote'])}”</div>"
                         f"<div><b>{e(x['b']['doc_title'])} {e(x['b']['clause_ref'])}</b><br>“{e(x['b']['quote'])}”</div></div>")
        if a.get("abstention"):
            parts.append(f"<div class='abst'>{e(a['abstention']['message'])}</div>")
    parts.append("</body></html>")
    return "".join(parts)
