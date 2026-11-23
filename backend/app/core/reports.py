"""Tamper-proof reports: every shared chat is issued as a signed record.

What is signed (canonical JSON, sorted keys): the report ID, when and by whom it was issued, every question with its
as-of date, verdicts, claims and verbatim quotes, the faithfulness figures, and a SHA-256 fingerprint of each source
PDF. The signature is Ed25519, so anyone holding the public key (GET /public/reports/key) can check a report without
trusting this server, and nobody without the private key can produce a valid one.

That gives three answers on the verify page:
  - genuine and unchanged: the signature matches and the record is in this server's register;
  - altered: a report claims this system's ID but its contents no longer match the signature;
  - not issued here: unknown ID or a signature from another key.
And one more check: a PDF dropped on the verify page is hashed in the browser and compared with the fingerprints, so
you can tell whether a document is the exact version the answers were based on.
"""

import base64
import hashlib
import json
import re
import secrets
from datetime import datetime, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from app.config import get_settings

ALG = "Ed25519"
_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I: an ID read out over the phone stays unambiguous
_key: Ed25519PrivateKey | None = None


def signing_key() -> Ed25519PrivateKey:
    """REPORT_SIGNING_KEY (base64 of a 32-byte seed) in production. Without it the seed is derived from JWT_SECRET,
    so the key survives restarts and redeploys as long as that secret does (it must: old reports have to verify)."""
    global _key
    if _key is None:
        s = get_settings()
        if s.report_signing_key:
            seed = base64.b64decode(s.report_signing_key)
            if len(seed) != 32:
                raise ValueError("REPORT_SIGNING_KEY must be base64 of exactly 32 bytes")
        else:
            seed = hashlib.sha256(b"zeroguess-report-signing-v1|" + s.jwt_secret.encode()).digest()
        _key = Ed25519PrivateKey.from_private_bytes(seed)
    return _key


def public_key_bytes() -> bytes:
    return signing_key().public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)


def key_id() -> str:
    return hashlib.sha256(public_key_bytes()).hexdigest()[:16]


def new_report_id() -> str:
    raw = "".join(secrets.choice(_ID_ALPHABET) for _ in range(8))
    return f"ZG-{raw[:4]}-{raw[4:]}"


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def fingerprint(payload: dict) -> str:
    return hashlib.sha256(canonical(payload)).hexdigest()


def sign(payload: dict) -> str:
    return base64.b64encode(signing_key().sign(canonical(payload))).decode()


def signature_valid(payload: dict, signature: str, pub: bytes | None = None) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(pub or public_key_bytes()).verify(base64.b64decode(signature), canonical(payload))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


def _claim(c: dict, sha_by_doc: dict[str, str]) -> dict:
    return {"text": c.get("text_hi") or c["text"], "verdict": c["verdict"], "reason": c.get("reason"),
            "citations": [{"doc_title": x.get("doc_title"), "doc_sha256": sha_by_doc.get(x.get("doc_id", "")),
                           "clause_ref": x.get("clause_ref"), "page": x.get("page"), "quote": x.get("quote")}
                          for x in c.get("citations", [])]}


def build_payload(report_id: str, title: str, turns: list[dict], docs: list[dict], issuer_name: str | None,
                  issuer_email: str | None) -> dict:
    """turns: [{turn, question, as_of, answer}]; docs: [{id, title, filename, sha256, page_count}] for every cited one."""
    sha_by_doc = {d["id"]: d["sha256"] for d in docs}
    out_turns = []
    for t in turns:
        a = t["answer"] or {}
        out_turns.append({
            "turn": t["turn"], "question": t["question"], "as_of": t["as_of"], "status": a.get("status"),
            "reply": a.get("reply"),
            "claims": [_claim(c, sha_by_doc) for c in a.get("claims", [])],
            "faithfulness": a.get("faithfulness"),
            "abstention": (a.get("abstention") or {}).get("message"),
            "conflicts": [{"subject": x.get("subject"), "a": {"doc_title": x["a"].get("doc_title"), "page": x["a"].get("page"), "quote": x["a"].get("quote")},
                           "b": {"doc_title": x["b"].get("doc_title"), "page": x["b"].get("page"), "quote": x["b"].get("quote")}}
                          for x in a.get("contradictions", [])],
        })
    domain = issuer_email.split("@", 1)[1] if issuer_email and "@" in issuer_email else None
    return {
        "v": 1, "id": report_id, "alg": ALG, "key_id": key_id(),
        "issued_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        # the name and the organisation's domain, not the full address: the report is readable by anyone with the link
        "issued_by": {"name": issuer_name or "Service account", "domain": domain},
        "title": title, "turns": out_turns,
        "documents": [{"title": d["title"], "filename": d["filename"], "sha256": d["sha256"], "pages": d["page_count"]}
                      for d in docs],
    }


_EMBED = re.compile(r'<script type="application/json" id="zg-report">(.*?)</script>', re.S)


def from_html(html: str) -> dict | None:
    """The signed block embedded in an offline HTML copy."""
    m = _EMBED.search(html)
    if not m:
        return None
    try:
        return json.loads(m.group(1).replace("<\\/", "</"))
    except ValueError:
        return None


def embed(block: dict) -> str:
    # "</" can't appear inside a <script> element
    return '<script type="application/json" id="zg-report">' + json.dumps(block, ensure_ascii=False).replace("</", "<\\/") + "</script>"
