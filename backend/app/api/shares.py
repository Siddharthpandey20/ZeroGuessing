"""Shareable chats (plan K.4): frozen read-only snapshot behind an unguessable token + self-contained HTML export.
The public routes are the only unauthenticated ones besides /health."""

import base64
import html
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.render import render_crop
from app.db import get_session
from app.config import get_settings
from app.core import reports
from app.models import Chat, Document, Report, Sentence, Share, User
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
    from app.api.chats import _messages, _path  # the branch on screen, not every version ever asked

    path = [m for m in _path(await _messages(session, chat_id), chat.current_message_id)
            if body.turn is None or m.turn == body.turn]
    latest = {m.turn: m for m in path if m.status == "done"}
    if not latest:
        raise HTTPException(400, "nothing to share yet")
    answers = [m.answer for m in latest.values()]
    snapshot = {
        "title": chat.title, "frozen_at": datetime.now(timezone.utc).isoformat(),
        "turns": [{"turn": m.turn, "question": m.question, "as_of": m.as_of.isoformat(), "answer": m.answer} for m in latest.values()],
        "crops": await _crops(session, answers) if body.include_crops else {},
    }
    token = secrets.token_urlsafe(24)
    # sign it: the content, who issued it and when, and a fingerprint of every source PDF
    rid = reports.new_report_id()
    while await session.get(Report, rid) is not None:
        rid = reports.new_report_id()
    payload = reports.build_payload(rid, chat.title, snapshot["turns"], await _cited_docs(session, answers),
                                    *(await _issuer(session, p)))
    sig = reports.sign(payload)
    fp = reports.fingerprint(payload)
    snapshot["report"] = {"id": rid, "fingerprint": fp, "signature": sig, "payload": payload}
    share = Share(token=token, chat_id=chat_id, snapshot=snapshot,
                  expires_at=datetime.now(timezone.utc) + timedelta(days=body.expires_days))
    session.add(share)
    session.add(Report(id=rid, share_token=token, payload=payload, fingerprint=fp, signature=sig))
    await session.commit()
    return {"token": token, "path": f"/public/shares/{token}", "html_path": f"/public/shares/{token}/html",
            "report_id": rid, "fingerprint": fp,
            "expires_at": share.expires_at, "warning": "Anyone with this link can read the quoted passages in this chat."}


async def _cited_docs(session: AsyncSession, answers: list[dict]) -> list[dict]:
    ids = {c.get("doc_id") for a in answers for cl in a.get("claims", []) for c in cl.get("citations", [])}
    ids |= {side.get("doc_id") for a in answers for x in a.get("contradictions", []) for side in (x["a"], x["b"])}
    ids.discard(None)
    if not ids:
        return []
    docs = (await session.execute(select(Document).where(Document.id.in_(ids)).order_by(Document.title))).scalars()
    return [{"id": d.id, "title": d.title, "filename": d.filename, "sha256": d.sha256, "page_count": d.page_count} for d in docs]


async def _issuer(session: AsyncSession, p: Principal) -> tuple[str | None, str | None]:
    u = p.user if p.user is not None else None
    if u is None:
        return None, None
    u = await session.get(User, u.id) or u
    return u.name or u.email.split("@")[0], u.email


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
async def export_html(token: str, request: Request, session: AsyncSession = Depends(get_session)):
    origin = get_settings().public_origin.rstrip("/") or str(request.base_url).rstrip("/")
    return HTMLResponse(render_snapshot_html((await _live(session, token)).snapshot, origin),
                        headers={"Content-Disposition": f'inline; filename="chat-{token[:8]}.html"'})


_CSS = """body{font:15px/1.5 system-ui,sans-serif;max-width:860px;margin:24px auto;padding:0 16px;color:#1a1a1a;background:#fff}
h1{font-size:20px}.banner{background:#f4f4f0;border:1px solid #ddd;padding:8px 12px;border-radius:6px;font-size:13px}
.q{font-weight:600;margin-top:28px}.claim{margin:6px 0}.blocked{color:#8a1c1c;text-decoration:line-through}
.reason{font-size:12px;color:#8a1c1c;margin-left:6px}.cite{display:inline-block;font-size:12px;background:#eef2ff;
border-radius:4px;padding:1px 6px;margin-left:4px;position:relative}.cite .tip{display:none;position:absolute;z-index:5;
left:0;top:20px;width:520px;background:#fff;border:1px solid #ccc;box-shadow:0 4px 16px #0002;padding:6px}
.cite:hover .tip{display:block}.cite img{max-width:100%}.score{font-size:13px;color:#444}
.conflict{display:grid;grid-template-columns:1fr 1fr;gap:10px;border:1px solid #e0b000;border-radius:6px;padding:8px;margin:8px 0}
.abst{background:#fff7e6;border-left:3px solid #e0a000;padding:6px 10px}
.seal{display:grid;gap:4px;margin:16px 0 8px;padding:12px 14px;border:1px solid #9fd36a;border-radius:8px;background:#f6fbef;font-size:13px}
.seal b{font-size:14px}.seal code{font:12px ui-monospace,monospace;word-break:break-all;color:#334}"""


def render_snapshot_html(snap: dict, origin: str = "") -> str:
    e = html.escape
    crops = snap.get("crops", {})

    def cite(c: dict) -> str:
        img = f'<img src="data:image/png;base64,{crops[c["sentence_id"]]}">' if c["sentence_id"] in crops else ""
        return (f'<span class="cite">{e(c["doc_title"])} · {e(c["clause_ref"])} · p.{c["page"]}<span class="tip">{img}'
                f'<div>“{e(c["quote"])}”</div></span></span>')

    parts = [f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
             f"<title>{e(snap['title'])}</title><style>{_CSS}</style></head><body><h1>{e(snap['title'])}</h1>",
             _seal_html(snap, origin),
             f"<div class='banner'>Frozen on {e(snap['frozen_at'][:10])}. Read-only record of what the system answered and the "
             f"proof it showed. Documents may have changed since.</div>"]
    for t in snap["turns"]:
        a = t["answer"] or {}
        f = a.get("faithfulness") or {}
        parts.append(f"<div class='q'>Q{t['turn']}. {e(t['question'])} <span class='score'>(as of {e(t['as_of'])})</span></div>")
        if a.get("status") == "chat":  # a conversational reply: nothing quoted, nothing to score
            parts.append(f"<div class='claim'>{e(a.get('reply', ''))} <span class='score'>(a reply, not from the documents)</span></div>")
            continue
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
    if snap.get("report"):
        r = snap["report"]
        parts.append(reports.embed({"payload": r["payload"], "signature": r["signature"], "fingerprint": r["fingerprint"]}))
    parts.append("</body></html>")
    return "".join(parts)


def _seal_html(snap: dict, origin: str) -> str:
    r = snap.get("report")
    if not r:
        return ""
    e = html.escape
    p = r["payload"]
    by = p["issued_by"]["name"] + (f" ({p['issued_by']['domain']})" if p["issued_by"].get("domain") else "")
    url = f"{origin}/verify/{r['id']}"
    return (f"<div class='seal'><b>Signed report {e(r['id'])}</b><span>Issued by {e(by)} on {e(p['issued_at'][:10])}. "
            f"Signed with {e(p['alg'])}; any change to a question, answer, quote or document fingerprint breaks the signature.</span>"
            f"<span>Fingerprint <code>{e(r['fingerprint'])}</code></span>"
            f"<span>Check it: <a href='{e(url)}'>{e(url)}</a> (or upload this file there).</span></div>")


# ---------------------------------------------------------------- tamper-proof reports: public verification
class VerifyIn(BaseModel):
    payload: dict | None = None
    signature: str | None = None
    html: str | None = Field(None, max_length=20_000_000, description="an offline HTML copy, as text")


def _norm_id(rid: str) -> str:
    raw = "".join(ch for ch in rid.upper() if ch.isalnum()).removeprefix("ZG")
    return f"ZG-{raw[:4]}-{raw[4:8]}" if len(raw) == 8 else rid.strip().upper()


async def _record(session: AsyncSession, rid: str) -> tuple[Report | None, str | None]:
    """The registered report and the state of its share link: active | revoked | expired | removed (the chat, and
    with it the link, was deleted)."""
    rep = await session.get(Report, _norm_id(rid))
    if rep is None:
        return None, None
    share = await session.get(Share, rep.share_token) if rep.share_token else None
    if share is None:
        return rep, "removed"
    exp = share.expires_at.replace(tzinfo=share.expires_at.tzinfo or timezone.utc)
    return rep, "revoked" if share.revoked else "expired" if exp < datetime.now(timezone.utc) else "active"


_WITHHELD = {
    "revoked": "The sender withdrew this report's share link, so its contents are no longer shown here.",
    "expired": "This report's share link has expired, so its contents are no longer shown here.",
    "removed": "This report's share link no longer exists, so its contents are no longer shown here.",
}


def _contents(rep: Report, link: str | None) -> dict:
    """S7: the issued contents only while the share link is live. Afterwards the register still answers whether a
    copy is genuine or altered, but shows nothing of what it says."""
    if link == "active":
        return {"payload": rep.payload, "signature": rep.signature}
    return {"withheld": True, "withheld_reason": _WITHHELD.get(link or "removed", _WITHHELD["removed"])}


@public.get("/public/reports/key")
async def report_key():
    """The public key reports are signed with: verify one yourself with any Ed25519 library."""
    return {"alg": reports.ALG, "key_id": reports.key_id(), "public_key": base64.b64encode(reports.public_key_bytes()).decode(),
            "canonical_form": "JSON with sorted keys, separators (',', ':'), UTF-8, no ASCII escaping"}


@public.get("/public/reports/{rid}")
async def report_lookup(rid: str, session: AsyncSession = Depends(get_session)):
    """A report from the register by its ID. The content is what was issued: compare it with the copy you were sent."""
    rep, link = await _record(session, rid)
    if rep is None:
        raise HTTPException(404, "No report with this ID was issued here.")
    return {"status": "genuine" if reports.signature_valid(rep.payload, rep.signature) else "altered",
            "id": rep.id, "fingerprint": rep.fingerprint, "link": link, **_contents(rep, link)}


@public.post("/public/reports/verify")
async def report_verify(body: VerifyIn, session: AsyncSession = Depends(get_session)):
    """Check a report someone sent you: its signed block (or the whole offline HTML copy)."""
    block = reports.from_html(body.html) if body.html else {"payload": body.payload, "signature": body.signature}
    if not block or not isinstance(block.get("payload"), dict) or not block.get("signature"):
        return {"status": "unsigned", "detail": "No signed report was found in this file."}
    payload, sig = block["payload"], str(block["signature"])
    if not reports.signature_valid(payload, sig):
        rep, link = await _record(session, str(payload.get("id", "")))
        return {"status": "altered" if rep else "foreign", "id": payload.get("id"),
                "detail": "The contents do not match the signature: something was changed after it was issued." if rep
                else "This report was not issued by this system.",
                **({"fingerprint": rep.fingerprint, "link": link, **_contents(rep, link)} if rep else {})}
    rep, link = await _record(session, str(payload.get("id", "")))
    if rep is None or rep.fingerprint != reports.fingerprint(payload):
        return {"status": "altered", "id": payload.get("id"), "detail": "Signed, but not the report registered under this ID."}
    return {"status": "genuine", "id": rep.id, "fingerprint": rep.fingerprint, "link": link, **_contents(rep, link)}
