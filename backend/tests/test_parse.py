from app.ingest.htmlpdf import html_to_pdf
from app.ingest.parse import parse_pdf

ROWS = "".join(f"<tr><td>Charge {i}</td><td>Home loan</td><td>Rs. {i * 100}</td></tr>" for i in range(1, 46))
HTML = f"""
<h1>Master Policy on Retail Loans</h1>
<p class="meta">Circular No. SCB/RL/2025/01 dated 1 April 2025</p>
<h2>7. Prepayment</h2>
<p>7.1 Borrowers may prepay the loan in full or in part at any time.</p>
<p>7.2 The prepayment penalty on floating-rate loans shall be two per cent (2%) of the outstanding principal.
The penalty shall be waived for prepayment from own sources. Rs. 500 is charged per request.</p>
<p>(a) This applies to individual borrowers only;</p>
<p>(b) Business borrowers are governed by clause 7.3.</p>
<p>7.3 The penalty on fixed-rate loans shall be 3% of the amount prepaid.</p>
<h2>Schedule I: Fees and Charges</h2>
<table><thead><tr><th>Charge</th><th>Product</th><th>Amount</th></tr></thead><tbody>{ROWS}</tbody></table>
"""


def test_parse_structure_and_bboxes():
    d = parse_pdf(html_to_pdf(HTML, footer="Sunrise Co-operative Bank"))
    refs = [c.ref for c in d.clauses]
    assert d.title.startswith("Master Policy on Retail Loans")
    assert d.circular_no == "SCB/RL/2025/01"
    assert d.issue_date == "2025-04-01"
    assert d.doc_type == "master"
    for r in ["7.1", "7.2", "7.2(a)", "7.2(b)", "7.3", "Schedule I"]:
        assert r in refs, refs
    c72 = next(c for c in d.clauses if c.ref == "7.2")
    assert len(c72.sentences) == 3, [s.text for s in c72.sentences]
    assert c72.sentences[0].text.startswith("The prepayment penalty")
    assert "Prepayment" in c72.heading_path
    assert all(len(bb) == 5 and bb[0] == 1 for s in c72.sentences for bb in s.bboxes)
    # no footer noise leaks into clause text
    assert all("Page " not in s.text for c in d.clauses for s in c.sentences)


def test_table_rows_span_pages_with_header():
    d = parse_pdf(html_to_pdf(HTML))
    sched = next(c for c in d.clauses if c.ref == "Schedule I")
    rows = [s for s in sched.sentences if s.is_table_row]
    assert len(rows) == 45, len(rows)
    assert {s.page for s in rows} == {1, 2} or len({s.page for s in rows}) >= 2
    assert "Charge: Charge 45 | Product: Home loan | Amount: Rs. 4500" in rows[-1].text


def test_scanned_pdf_is_read_with_ocr_or_reported():
    """A page that is only a picture: read with Tesseract where it's installed (the Docker image), otherwise
    reported as unread so ingestion can say why, never silently empty."""
    import pymupdf

    from app.ingest.htmlpdf import html_to_pdf
    from app.ingest.parse import ocr_tessdata, parse_pdf

    src = pymupdf.open(stream=html_to_pdf("<h1>Master Policy</h1><p>7.2 The prepayment penalty shall be 2% of the "
                                          "outstanding principal.</p>"), filetype="pdf")
    scan = pymupdf.open()
    for page in src:
        p = scan.new_page(width=page.rect.width, height=page.rect.height)
        p.insert_image(p.rect, pixmap=page.get_pixmap(dpi=200))
    doc = parse_pdf(scan.tobytes())
    if ocr_tessdata() is None:
        assert doc.unread_pages == [1] and not doc.clauses
    else:
        assert doc.ocr_pages == [1] and "2%" in " ".join(c.text for c in doc.clauses)
