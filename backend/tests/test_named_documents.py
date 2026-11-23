"""Documents a question names (gap 2/4), and the verifier rules that use them and a cited sentence's clause neighbours.
Every verify() case here is settled before the model judge, so no model is called."""

import asyncio

from app.core.products import identify, named_in
from app.core.retrieve import Evidence
from app.core.verify import _leans, verify
from app.schemas import Draft, DraftClaim

LIB = "LIBHLGP22010"
TITLES = {"pw": "Policy Wordings", "lib": "Liberty Group Health Policy Policy Wordings",
          "ni": "New India Assurance Group Mediclaim Policy", "ngh": "Niva Bupa Group Health Insurance Policy",
          "nha": "Niva Bupa Health Assurance Policy", "tata": "Tata AIG Group MediCare Policy"}
PRODS = {"pw": identify(TITLES["pw"], [LIB]), "lib": identify(TITLES["lib"], [LIB]),
         **{d: identify(TITLES[d], []) for d in ("ni", "ngh", "nha", "tata")}}


def named(q):
    return named_in(q, TITLES, PRODS)


def test_title_names_one_document_insurer_names_its_product():
    assert named("How long is the free look period in the Policy Wordings document?") == [{"pw"}]
    # the companion document with the same UIN belongs to the named product
    assert named("How many days' notice to cancel the Liberty group health policy?") == [{"lib", "pw"}]


def test_product_words_pick_the_right_policy_of_one_insurer():
    assert named("What is the room rent limit under the Niva Bupa Health Assurance policy?") == [{"nha"}]
    assert named("Compare the waiting periods of the New India Assurance and Niva Bupa Group Health policies.") == [
        {"ni"}, {"ngh"}]
    # only the insurer: both of its policies are named
    assert named("Within how many days can a member ask Niva Bupa for a retail policy?") == [{"ngh"}, {"nha"}]
    assert named("What is the ambulance cover?") == []


def _ev(eid, doc, text, status="current"):
    return Evidence(eid=eid, sentence_id=eid, doc_id=doc, doc_title=TITLES.get(doc, doc), clause_id="c",
                    clause_ref="1", heading_path="", page=1, text=text, bboxes=[], is_table_row=False,
                    status=status, status_note="CURRENT" if status == "current" else "SUPERSEDED by X")


def _run(claims, ev, **kw):
    return asyncio.run(verify(Draft(answerable=True, claims=claims), ev, "2026-11-23", **kw))


def test_claim_citing_an_unnamed_document_is_blocked():
    ev = [_ev("e1", "lib", "The insured person shall be allowed free look period of 30 days from receipt.")]
    out = _run([DraftClaim(t="The free look period is 30 days.", cite=["e1"])], ev, named=[{"pw"}])
    assert out[0].verdict == "unsupported" and "asks about Liberty" not in out[0].reason and "asks about" in out[0].reason
    # citing the named document passes this check (blocked later only because the clause is superseded: no judge call)
    ok = _run([DraftClaim(t="The free look period is 30 days.", cite=["e1"])],
              [_ev("e1", "pw", ev[0].text, status="superseded")], named=[{"pw"}])
    assert ok[0].reason.startswith("cites Policy Wordings 1, which is")


def test_value_in_the_next_sentence_of_the_clause():
    # a superseded clause: once the values pass, the claim stops at the supersession rule, before the judge
    e1 = _ev("e1", "ni", "Ambulance charges are payable in case of emergency shifting to hospital.", "superseded")
    nxt = _ev("n1", "ni", "The amount payable shall not exceed Rs. 2,500 per hospitalisation.", "superseded")
    claim = DraftClaim(t="Ambulance charges are capped at Rs. 2,500.", cite=["e1"])
    assert _run([claim], [e1])[0].reason.startswith("value(s)")  # alone: the value is missing
    out = _run([claim], [e1], neighbours={"e1": [nxt]})
    assert "which is" in out[0].reason  # the value check passed with the neighbour
    assert [c["sentence_id"] for c in out[0].citations] == ["e1", "n1"]  # and the neighbour is quoted


def test_neighbours_not_attached_to_a_self_contained_sentence():
    e1 = _ev("e1", "ni", "The policyholder may cancel this policy by giving 15 days written notice to the Company.",
             "superseded")
    out = _run([DraftClaim(t="Cancellation needs 15 days notice.", cite=["e1"])], [e1],
               neighbours={"e1": [_ev("n1", "ni", "Premium is refunded on a short period scale.", "superseded")]})
    assert [c["sentence_id"] for c in out[0].citations] == ["e1"]


def test_leans():
    assert _leans("In such cases, the Company shall settle the claim within 30 days.")
    assert _leans("any benefit has i.")
    assert not _leans("The policyholder may cancel this policy by giving 15 days written notice to the Company.")
