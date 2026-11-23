"""Product identity: a conflict is only possible between versions/parts of the same product (or unknown issuers)."""

from app.core.products import identify, related, same_product

LIB = "LIBHLGP22010"


def test_uin_decides_when_both_have_one():
    a = identify("Policy Wordings", [LIB, LIB])
    b = identify("Liberty Group Health Policy Policy Wordings", [LIB])
    assert a.insurer == "liberty" and a.code == LIB
    assert same_product(a, b)
    assert not same_product(a, identify("SBI General Group Mediclaim Policy", ["SBIHLGP24031"]))
    # a new version of the same product keeps its product code
    assert same_product(identify("Liberty Group Health v2", [LIB]), b)


def test_different_insurers_are_different_products():
    hdfc = identify("HDFC ERGO Group Mediclaim Policy", [])
    ni = identify("New India Assurance Group Mediclaim Policy", [])
    assert (hdfc.insurer, ni.insurer) == ("hdfcergo", "newindia")
    assert not same_product(hdfc, ni)
    # insurer from the UIN prefix vs insurer from a title
    assert not same_product(identify("Policy Wordings", [LIB]), hdfc)


def test_same_insurer_different_product_names():
    g = identify("Niva Bupa Group Health Insurance Policy", [])
    h = identify("Niva Bupa Health Assurance Policy", [])
    assert g.insurer == h.insurer == "nivabupa"
    assert not same_product(g, h)
    # a schedule of the same product: the form words are generic, the name is a subset
    assert same_product(g, identify("Niva Bupa Group Health Policy Schedule", []))


def test_unknown_issuer_stays_eligible():
    # the demo bank's documents: no known insurer, no UIN -> the model decides, as before
    a = identify("Master Policy on Retail Loans", [])
    b = identify("Key Facts Statement – Home Loan", [])
    assert a.insurer is None and same_product(a, b)
    assert same_product(a, identify("HDFC ERGO Group Mediclaim Policy", []))


def test_related_same_document_and_missing():
    p = {"x": identify("HDFC ERGO Group Mediclaim Policy", []), "y": identify("Tata AIG Group MediCare Policy", [])}
    assert related(p, "x", "x")
    assert not related(p, "x", "y")
    assert related(p, "x", "unknown-doc")
