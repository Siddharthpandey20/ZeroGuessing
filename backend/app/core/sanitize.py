"""Clean model-written text before anyone sees it (S5).

A claim is checked against its quotes, but some model text is shown as it was written: the "missing" list, blocked
claims (struck through, still readable), translations, the rewritten follow-up, judge reasons, conflict explanations,
amendment values, chat names. A PDF crafted to steer the model could make any of them carry a fake helpline number,
website or email address. Rule: a link, email address or phone number may appear only if it is written in the text
the model was given for that output (the quotes, the question). Anything else is removed. Markup and invisible
characters (HTML tags, markdown links and images, control and bidi-override characters) are removed always.
"""

import re
import unicodedata

_TAG = re.compile(r"</?[A-Za-z][^<>]{0,300}>")
_MD_IMAGE = re.compile(r"!\[[^\]]{0,300}\]\([^)]{0,500}\)")
_MD_LINK = re.compile(r"\[([^\]]{0,300})\]\(([^)]{0,500})\)")
# control characters, zero-width space/joiners except ZWNJ/ZWJ (U+200C/D: Devanagari spelling needs them),
# left/right marks, bidi embeddings/overrides/isolates, word joiner and invisible operators, BOM
_INVISIBLE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‎‏‪-‮⁠-⁤⁦-⁩﻿]")

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_TLD = ("com|in|org|net|io|co|info|biz|xyz|app|ly|me|gov|edu|top|site|online|link|click|shop|live|bank|insure|"
        "support|help|pay|money|loan|loans|finance|ru|cn|tk|ml|ga|cf|gq|uk|us|ai|dev|page|pro|cc|to|gg|tv|ws|sh|so|"
        "store|tech|cloud|space|fun|icu|vip|club|work|life|world|today|news|digital|email|network|services|care|"
        "health|insurance|claims|capital|fund|cash|credit|tax|win|bid|guru|pw|su|ng|pk|bd|lk|np|ae|sg|my|hk|au|ca|"
        "de|fr|nl|eu|ch|br|za|ke|website|web|host|center|solutions|agency|group|ltd|company|exchange|trade|global")
_SCHEME_URL = r"(?:\b(?:https?|ftp)://|\bwww\.)[^\s<>\"'`)\]]+"
_BARE_URL = rf"\b(?:[a-z0-9](?:[a-z0-9-]{{0,61}}[a-z0-9])?\.)+(?P<tld>{_TLD})\b(?:/[^\s<>\"'`)\]]*)?"
_URL = re.compile(rf"(?i){_SCHEME_URL}|{_BARE_URL}")
# "the policy.In case of ...", "Sum insured.Co-payment": a sentence run into the next, not a domain
_RUN_ON = {"in", "is", "it", "at", "be", "by", "do", "go", "me", "my", "no", "on", "or", "so", "to", "us", "co", "an",
           "as", "if", "of", "up", "we"}
# phone separators: spaces (also no-break and thin), hyphens and dashes, dots, brackets, middle dots and bullets
_SEP = r" \-().  -  ‐-―−·•‧"
# 10+ digits written as one number, with the separators people put in phone numbers ("+91 98xxx-xxxxx", "1800 123 4567").
# Dates, amounts after a currency sign, amounts with commas and clause numbers are not phone numbers.
_PHONE = re.compile(rf"(?<![\w/])\+?\(?\d[\d{_SEP}]{{8,}}\d(?![\w/])")
_DATE = re.compile(r"\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})(?!\d)|\d{4}-\d{2}-\d{2}(?!\d)")
_CURRENCY = re.compile(r"(?:\brs\.?|\binr|₹|\$|€|£)\s*$", re.IGNORECASE)
REMOVED = "[removed]"


def _digits(s: str) -> str:
    """The digits of s, any script (Devanagari ०-९, full-width ...) written as 0-9."""
    return "".join(str(unicodedata.decimal(c)) for c in s if unicodedata.decimal(c, None) is not None)


def _number_key(d: str) -> str:
    """One key per phone number however it is written: +91 98765 43210, 098765 43210 and 9876543210 are the same."""
    return d[-10:]


def _host(u: str) -> tuple[str, str]:
    """(host, host+path) of a link, lower-case, without scheme, www., port or trailing punctuation."""
    u = re.sub(r"^(?:https?|ftp)://", "", u.lower().rstrip(".,;:!?/"))
    u = u.removeprefix("www.")
    host = re.split(r"[/:?#]", u, maxsplit=1)[0]
    return host, u


def _is_run_on(m: re.Match) -> bool:
    tld = m.group("tld")
    return bool(tld) and tld[0].isupper() and tld[1:].islower() and tld.lower() in _RUN_ON and "/" not in m.group()


def _phone_digits(m: re.Match, text: str) -> str | None:
    """The digits of a phone-number-looking match, or None when it is a date or an amount."""
    if _CURRENCY.search(text[max(0, m.start() - 6):m.start()]):
        return None
    d = _digits(_DATE.sub(" ", m.group()))
    return d if len(d) >= 10 else None


class _Known:
    """The links, email addresses and phone numbers written in the sources."""

    def __init__(self, sources: list[str]):
        text = " ".join(sources)
        self.text = text.lower()
        self.emails = {e.lower() for e in _EMAIL.findall(text)}
        self.hosts: set[str] = set()
        for m in _URL.finditer(text):
            if not _is_run_on(m):
                self.hosts.add(_host(m.group())[0])
        self.numbers = {_number_key(d) for m in _PHONE.finditer(text) if (d := _phone_digits(m, text))}
        squeezed = re.sub(rf"(?<=\d)[{_SEP}]+(?=\d)", "", text)
        self.numbers |= {_number_key(_digits(x)) for x in re.findall(r"\d{10,}", squeezed)}

    def email(self, e: str) -> bool:
        return e.lower() in self.emails

    def url(self, u: str) -> bool:
        host, path = _host(u)
        # the same site (or a subdomain of it: only its owner controls those), and any path written in the sources
        if not any(host == k or host.endswith("." + k) for k in self.hosts):
            return False
        return path == host or path in self.text

    def number(self, d: str) -> bool:
        return _number_key(d) in self.numbers


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
        known = _Known(sources)
        mark = "" if strip_unknown else REMOVED

        def email(m: re.Match) -> str:
            return m.group() if known.email(m.group()) else mark

        def url(m: re.Match) -> str:
            if _is_run_on(m) or known.url(m.group()):
                return m.group()
            return mark

        def phone(m: re.Match) -> str:
            d = _phone_digits(m, t)
            return m.group() if d is None or known.number(d) else mark

        t = _EMAIL.sub(email, t)
        t = _URL.sub(url, t)
        t = _PHONE.sub(phone, t)
    t = re.sub(r"[ \t]{2,}", " ", t).strip()
    if len(t) > max_len:
        t = t[: max_len - 1].rstrip() + "…"
    return t
