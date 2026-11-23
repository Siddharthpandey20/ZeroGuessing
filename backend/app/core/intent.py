"""What kind of message is this, before anything is searched.

Every message used to go retrieve -> draft -> verify, so "hi", "what can you do?", "what is this document about?" and
"and for fixed rate?" all ended in "I don't have proof". Three cases now get their own path:
  - small talk and help: a short reply, marked as not coming from the documents (no claims, nothing to verify);
  - document overview: built in code from the documents' own titles, page counts and section headings, each line
    citing the opening sentence of the sections it lists;
  - follow-ups: rewritten into a standalone question from the previous turns, then answered the usual way.
Factual answers keep the same rule as before: only claims a quote proves are shown.
"""

import asyncio
import logging
import re

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.gemini import get_llm
from app.models import Clause, Document, Sentence

log = logging.getLogger(__name__)

_END = r"[\s!.?,🙂😊🙏]*$"
_SMALLTALK = re.compile(
    r"^\s*(hi+|hello|hey|hiya|yo|namaste|namaskar|नमस्ते|नमस्कार|good (morning|afternoon|evening|night)|"
    r"thanks|thank you|thank u|thankyou|thx|ty|धन्यवाद|शुक्रिया|ok|okay|okk+|cool|great|nice|awesome|got it|"
    r"bye|goodbye|see you|cheers)( (there|zeroguess|so much|a lot|again|buddy|man))?" + _END, re.I)
_HELP = re.compile(
    r"^\s*(help|help me|what can you do|what do you do|who are you|what are you|how (do|does) (you|this|it) work|"
    r"how (do i|to) use (you|this|it|zeroguess)|what can i ask( you)?|what should i ask|how can you help( me)?)" + _END, re.I)
_DOC = r"(document|documents|doc|docs|pdf|pdfs|paper|papers|file|files|report|reports|policy|policies|circulars?)"
_OVERVIEW = [re.compile(p + _END, re.I) for p in (
    r"^\s*(what('s| is| are)|tell me|give me|can you (give|tell)( me)?|show( me)?)?\s*(a |an |the )?(brief |short |quick )?"
    r"(summary|overview|gist|outline|synopsis)( of)?( this| the| these| my| all)?( " + _DOC + r")?",
    r"^\s*(please )?(summari[sz]e|outline|describe|explain)( this| the| these| my| all)?( uploaded)? " + _DOC,
    r"^\s*what('s| is| are)( this| these| the| my)? " + _DOC + r"( about| on| for| saying)?",
    r"^\s*what (documents|files|pdfs|docs) (do i have|are (there|loaded|uploaded|here|in this chat)|have i (uploaded|added))",
    r"^\s*what (does|do) (this|the|these|my) " + _DOC + r" (say|contain|cover|discuss|talk about)",
    r"^\s*(list|show)( me)?( the| all)? (documents|files|pdfs|sections|contents|table of contents)",
)]
_FOLLOW_START = re.compile(
    r"^\s*(and|but|also|so|then|what about|how about|and what about|what if|why|how come|explain( it| that| this| more)?|"
    r"tell me more|more|elaborate|same for|is that|does that|can you explain( that| it)?|which one|in that case)\b", re.I)
_PRONOUN = re.compile(r"\b(it|that|this|these|those|they|them|its|their|above|previous|same|earlier|there)\b", re.I)


def classify(question: str) -> str:
    """'smalltalk' | 'help' | 'overview' | 'question'."""
    q = question.strip()
    if _SMALLTALK.match(q):
        return "smalltalk"
    if _HELP.match(q):
        return "help"
    if any(p.match(q) for p in _OVERVIEW):
        return "overview"
    return "question"


def is_followup(question: str) -> bool:
    """Leans on the previous turn: starts like a continuation, or is short and points back with a pronoun."""
    q = question.strip()
    return bool(_FOLLOW_START.match(q)) or (len(q.split()) <= 7 and bool(_PRONOUN.search(q)))


def chat_reply(question: str, kind: str, n_docs: int | None, lang: str | None = None) -> str:
    """`lang`: the answer language ('en' | 'hi' | 'hne'); None follows the question's script."""
    lang = lang or ("hi" if re.search(r"[ऀ-ॿ]", question) else "en")
    hindi = lang == "hi"
    q = question.strip().lower()
    docs = ("This chat has no documents yet: add PDFs with the paperclip or the Documents button." if n_docs == 0
            else f"This chat has {n_docs} document{'s' if n_docs != 1 else ''}." if n_docs else "")
    if kind == "help":
        return ("I answer questions about the documents in this chat, and only with what they prove: every sentence comes "
                "with a numbered citation you can hover to see the exact passage on its page. I also flag clauses that "
                "disagree, track which version of a rule applies on the date you pick, work out figures like an EMI from "
                "the cited numbers, and say \"I don't have proof\" instead of guessing. Ask in English or Hindi, by "
                f"typing, speaking or photographing a clause. {docs}").strip()
    if lang == "hne":  # Chhattisgarhi
        return "धन्यवाद! दस्तावेज मन के बारे म कुछु भी पूछव।" if re.search(r"धन्यवाद|शुक्रिया", question) else             "जोहार! ए चैट के दस्तावेज मन के बारे म पूछव, मँय हर जवाब के परमान देखाहूँ।"
    if hindi:
        return "धन्यवाद! दस्तावेज़ों के बारे में कुछ भी पूछिए।" if re.search(r"धन्यवाद|शुक्रिया", question) else \
            "नमस्ते! इस चैट के दस्तावेज़ों के बारे में पूछिए, मैं हर उत्तर का प्रमाण दिखाऊँगा।"
    if re.match(r"(thanks|thank|thx|ty|cheers)", q):
        return "You're welcome. Ask anything else about these documents."
    if re.match(r"(bye|goodbye|see you)", q):
        return "Goodbye. Your chat and its documents stay here when you come back."
    if re.match(r"(ok|okay|cool|great|nice|awesome|got it)", q):
        return "Ask your next question whenever you're ready."
    return f"Hello! Ask me anything about this chat's documents, and I'll answer only with quotes I can show you. {docs}".strip()


def _clean_heading(h: str) -> str:
    h = re.sub(r"\s+", " ", h or "").strip(" :.-")
    return h[:70] + ("…" if len(h) > 70 else "")


async def overview(session: AsyncSession, doc_ids: list[str] | None) -> tuple[list[dict], int]:
    """One claim per document: title, pages and its section headings, citing the opening sentences of those sections.
    Built by code from the documents themselves, so there is nothing for a model to get wrong."""
    q = select(Document).where(Document.active.is_(True), Document.ingest_status.like("indexed%")).order_by(Document.title)
    if doc_ids is not None:
        q = q.where(Document.id.in_(doc_ids))
    docs = list((await session.execute(q)).scalars())
    claims = []
    for d in docs[:12]:
        heads: list[str] = []
        cites: list[dict] = []
        for c in (await session.execute(select(Clause).where(Clause.document_id == d.id).order_by(Clause.ord))).scalars():
            h = _clean_heading(c.heading_path)
            if not h or h in heads or h.lower() == d.title.lower():
                continue
            heads.append(h)
            if len(cites) < 4:
                s = (await session.execute(select(Sentence).where(Sentence.clause_id == c.id).order_by(Sentence.ord).limit(1))).scalar()
                if s is not None:
                    cites.append({"sentence_id": s.id, "doc_id": d.id, "doc_title": d.title, "clause_ref": c.clause_ref,
                                  "page": s.page, "quote": s.text, "bboxes": s.bboxes, "status": "current", "status_note": None})
            if len(heads) >= 8:
                break
        pages = f"{d.page_count} page{'s' if d.page_count != 1 else ''}"
        if len(heads) >= 2:
            text = f"{d.title} ({pages}) covers: {'; '.join(heads)}."
        else:
            # no real sections (a circular, a letter): say what it opens with, quoted, from its first substantive sentence
            opening = None
            for s in (await session.execute(select(Sentence).where(Sentence.document_id == d.id)
                                            .order_by(Sentence.page, Sentence.ord).limit(12))).scalars():
                t = s.text.strip()
                letterhead = (t.lower().startswith(d.title.lower()[:24]) or re.search(r"\bTo:\s", t)
                              or re.match(r"^(to|from|ref|date|subject|circular no)\b", t, re.I))
                if len(t) >= 50 and not letterhead:
                    opening = s
                    break
            if opening is not None:
                cites = [{"sentence_id": opening.id, "doc_id": d.id, "doc_title": d.title, "clause_ref": None, "page": opening.page,
                          "quote": opening.text, "bboxes": opening.bboxes, "status": "current", "status_note": None}]
                quote = opening.text.strip()
                text = f"{d.title} ({pages}) opens: “{quote[:220]}{'…' if len(quote) > 220 else ''}”"
            else:
                text = f"{d.title} has {pages}."
        claims.append({"text": text, "verdict": "supported", "reason": "listed from the document's own section headings",
                       "citations": cites, "kind": "fact", "judge": None, "calculation": None, "conflict_ids": [], "text_hi": None})
    return claims, len(docs)


class Standalone(BaseModel):
    question: str = Field(description="the follow-up rewritten as one self-contained question")


async def resolve_followup(question: str, history: list[dict]) -> str:
    """'and for fixed rate?' after 'What is the prepayment penalty on a floating-rate home loan?' ->
    'What is the prepayment penalty on a fixed-rate home loan?'. Falls back to carrying the previous question along."""
    convo = "\n".join(f"Q: {h['question']}\nA: {h['answer'][:600]}" for h in history[-3:])
    try:
        out = await asyncio.wait_for(get_llm().generate_json(
            Standalone, f"CONVERSATION:\n{convo}\n\nFOLLOW-UP: {question}",
            "Rewrite the follow-up as one standalone question that can be understood without the conversation. Keep the "
            "user's wording, numbers and language. Do not answer it. If it is already standalone, return it unchanged."),
            timeout=15)
        q = out.question.strip()
        if q:
            return q
    except Exception as e:  # fake model, no key, or slow: keep the earlier question as context for the search
        log.info("follow-up rewrite skipped: %s", e)
    return f"{question.strip().rstrip('?')} (following on from: {history[-1]['question'].strip()})"
