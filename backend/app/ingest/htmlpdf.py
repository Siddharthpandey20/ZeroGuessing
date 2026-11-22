"""HTML -> paginated PDF with PyMuPDF Story (used for the demo corpus and tests; no browser needed)."""

import io

import pymupdf

CSS = """
body { font-family: sans-serif; font-size: 10pt; line-height: 1.35; }
h1 { font-size: 15pt; margin-bottom: 4pt; }
h2 { font-size: 11.5pt; margin-top: 10pt; }
p { margin: 3pt 0; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0; }
th, td { border: 1px solid #444; padding: 3pt 4pt; font-size: 9pt; }
th { font-weight: bold; background-color: #ddd; }
.meta { font-size: 9pt; }
"""


def html_to_pdf(html: str, footer: str = "", css: str = CSS) -> bytes:
    story = pymupdf.Story(html=html, user_css=css)
    buf = io.BytesIO()
    writer = pymupdf.DocumentWriter(buf)
    mediabox = pymupdf.paper_rect("a4")
    where = mediabox + (56, 56, -56, -64)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()
    doc = pymupdf.open(stream=buf.getvalue(), filetype="pdf")
    n = len(doc)
    for i, page in enumerate(doc):
        text = f"{footer}    Page {i + 1} of {n}" if footer else f"Page {i + 1} of {n}"
        page.insert_text((56, page.rect.height - 30), text, fontsize=8)
    return doc.tobytes(garbage=3, deflate=True)
