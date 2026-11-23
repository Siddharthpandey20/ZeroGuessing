"""Clean model-written text before anyone sees it (S5).

A claim is checked against its quotes, but some model text is shown as it was written: the "missing" list, blocked
claims (struck through, still readable), translations, the rewritten follow-up, judge reasons, conflict explanations,
amendment values, chat names. A PDF crafted to steer the model could make any of them carry a fake helpline number,
website or email address. Rule: a link, email address or phone number may appear only if it is written in the text
the model was given for that output (the quotes, the question). Anything else is removed. Markup and invisible
characters (HTML tags, markdown links and images, control and bidi-override characters) are removed always.
"""

import re

_TAG = re.compile(r"</?[A-Za-z][^<>]{0,300}>")
_MD_IMAGE = re.compile(r"!\[[^\]]{0,300}\]\([^)]{0,500}\)")
_MD_LINK = re.compile(r"\[([^\]]{0,300})\]\(([^)]{0,500})\)")
# control characters, zero-width space/joiners except ZWNJ/ZWJ (U+200C/D: Devanagari spelling needs them),
# left/right marks, bidi embeddings/overrides/isolates, word joiner and invisible operators, BOM
_INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‎‏‪-‮⁠-⁤⁦-⁩﻿]")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_TLD = ("com|in|org|net|io|co|info|biz|xyz|app|ly|me|gov|edu|top|site|online|link|click|shop|live|bank|insure|"
        "support|help|pay|money|loan|finance|ru|cn|tk|ml|ga|cf|gq|uk|us")
_URL = re.compile(rf"(?i)(?:\b(?:https?|ftp)://|\bwww\.)[^\s<>\"'`)\]]+"
                  rf"|\b(?:[a-z0-9](?:[a-z0-9-]{{0,61}}[a-z0-9])?\.)+(?:{_TLD})\b(?:/[^\s<>\"'`)\]]*)?")
# 10+ digits written as one number, with the separators people put in phone numbers ("+91 98xxx-xxxxx", "1800 123 4567").
# Dates (8 digits), amounts with commas and clause numbers stay below or outside this.
_PHONE = re.compile(r"(?<![\w/])\+?\(?\d[\d \-().]{8,}\d(?![\w/])")
REMOVED = "[removed]"


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s.translate(str.maketrans("०१२३४५६७८९", "0123456789")))


def _host_path(u: str) -> str:
    u = u.lower().rstrip(".,;:!?/")
    u = re.sub(r"^(?:https?|ftp)://", "", u)
    return u.removeprefix("www.")


def _known(sources: list[str]) -> tuple[str, set[str]]:
    text = " ".join(sources).lower()
    numbers = {_digits(m.group()) for m in _PHONE.finditer(" ".join(sources))}
    numbers |= set(re.findall(r"\d{10,}", _digits_runs(" ".join(sources))))
    return text, numbers


def _digits_runs(s: str) -> str:
    """Digits with separators squeezed out, numbers kept apart: '1800 123 4567 and 98' -> '18001234567 98'."""
    return re.sub(r"(?<=\d)[ \-().]+(?=\d)", "", s.translate(str.maketrans("०१२३४५६७८९", "0123456789")))


def clean_ai_text(text: str | None, sources: list[str] | None = None, max_len: int = 2000,
                  strip_unknown: bool = False) -> str:
    """`sources`: the text the model was given for this output; a link, email or phone number found there may stay.
    None = structural cleaning only (e.g. a photo transcription: the user reads and edits it before it is used).
    `strip_unknown`: drop unknown contacts silently instead of writing [removed]."""
    if not text:
        return text or ""
    t = _INVISIBLE.sub("", text)
    t = _MD_IMAGE.sub("", t)
    t = _MD_LINK.sub(lambda m: f"{m.group(1)} {m.group(2)}", t)
    t = _TAG.sub("", t)
    if sources is not None:
        known_text, known_numbers = _known(sources)
        mark = "" if strip_unknown else REMOVED

        def email(m: re.Match) -> str:
            return m.group() if m.group().lower() in known_text else mark

        def url(m: re.Match) -> str:
            return m.group() if _host_path(m.group()) in known_text else mark

        def phone(m: re.Match) -> str:
            d = _digits(m.group())
            if len(d) < 10:
                return m.group()
            return m.group() if any(d in k for k in known_numbers) else mark

        t = _EMAIL.sub(email, t)
        t = _URL.sub(url, t)
        t = _PHONE.sub(phone, t)
    t = re.sub(r"[ \t]{2,}", " ", t).strip()
    if len(t) > max_len:
        t = t[: max_len - 1].rstrip() + "…"
    return t
