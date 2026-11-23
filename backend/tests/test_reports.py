"""Tamper-proof reports: a share is issued as a signed record; the public verify endpoints tell genuine from altered
or foreign copies, from the ID, the signed block, or a whole offline HTML copy."""

import base64
import copy
import hashlib

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core import reports
from tests.test_chat_docs import MASTER, ask, client, pdf, sign_in  # noqa: F401  (client is a fixture)


async def test_signed_report_verifies_and_detects_tampering(client):  # noqa: F811
    c = client
    await sign_in(c, "asha@bank.example")
    chat = (await c.post("/api/chats", json={})).json()["id"]
    up = await c.post(f"/api/chats/{chat}/documents", files=[pdf("master.pdf", MASTER)])
    assert up.json()[0]["status"] == "queued"
    await ask(c, chat)
    share = (await c.post(f"/api/chats/{chat}/shares", json={})).json()
    rid = share["report_id"]
    assert rid.startswith("ZG-") and len(rid) == 12

    # the register: genuine, issued by name + domain only, with the source PDF's fingerprint
    reg = (await c.get(f"/public/reports/{rid}")).json()
    assert reg["status"] == "genuine" and reg["link"] == "active", reg
    p = reg["payload"]
    assert p["issued_by"] == {"name": "asha", "domain": "bank.example"} and "asha@" not in str(p)
    master_sha = hashlib.sha256(_pdf_bytes()).hexdigest()
    assert [d["sha256"] for d in p["documents"]] == [master_sha]
    assert p["turns"][0]["claims"][0]["citations"][0]["doc_sha256"] == master_sha
    assert (await c.get(f"/public/reports/{rid.lower().replace('-', '')}")).json()["id"] == rid  # typed loosely

    # the signed block itself, and the offline HTML copy carrying it
    snap = (await c.get(f"/public/shares/{share['token']}")).json()
    block = {"payload": snap["report"]["payload"], "signature": snap["report"]["signature"]}
    assert (await c.post("/public/reports/verify", json=block)).json()["status"] == "genuine"
    html = (await c.get(f"/public/shares/{share['token']}/html")).text
    assert f"Signed report {rid}" in html and f"/verify/{rid}" in html
    assert (await c.post("/public/reports/verify", json={"html": html})).json()["status"] == "genuine"

    # one changed figure in an answer: altered, and the genuine content comes back for comparison
    forged = copy.deepcopy(block)
    claim = forged["payload"]["turns"][0]["claims"][0]
    claim["text"] = claim["text"].replace("2%", "5%")
    assert claim["text"] != p["turns"][0]["claims"][0]["text"]
    r = (await c.post("/public/reports/verify", json=forged)).json()
    assert r["status"] == "altered" and r["payload"] == p, r
    tampered_html = html.replace(f'"name": "{p["issued_by"]["name"]}"', '"name": "mallory"')
    assert (await c.post("/public/reports/verify", json={"html": tampered_html})).json()["status"] == "altered"

    # someone else's key, an unknown ID, no signed block at all
    other = Ed25519PrivateKey.generate()
    fake = {**copy.deepcopy(block["payload"]), "id": "ZG-AAAA-BBBB"}
    fake_sig = base64.b64encode(other.sign(reports.canonical(fake))).decode()
    assert (await c.post("/public/reports/verify", json={"payload": fake, "signature": fake_sig})).json()["status"] == "foreign"
    assert (await c.get("/public/reports/ZG-AAAA-BBBB")).status_code == 404
    assert (await c.post("/public/reports/verify", json={"html": "<html>no report</html>"})).json()["status"] == "unsigned"

    # revoking the link withdraws access, not authenticity
    await c.delete(f"/api/shares/{share['token']}")
    reg = (await c.get(f"/public/reports/{rid}")).json()
    assert reg["status"] == "genuine" and reg["link"] == "revoked"

    key = (await c.get("/public/reports/key")).json()
    assert key["alg"] == "Ed25519" and base64.b64decode(key["public_key"]) == reports.public_key_bytes()


def _pdf_bytes() -> bytes:
    return pdf("master.pdf", MASTER)[1][1]
