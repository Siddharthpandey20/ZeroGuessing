"""Page images with highlighted sentence rectangles; cropped previews for hover tooltips (plan J.1)."""

import pymupdf

HIGHLIGHT = (1.0, 0.85, 0.0)


def render_page(pdf: bytes, page_no: int, boxes: list[list[float]], dpi: int = 110) -> bytes:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    if not 1 <= page_no <= len(doc):
        raise IndexError("page out of range")
    page = doc[page_no - 1]
    for b in boxes:
        if int(b[0]) == page_no:
            page.draw_rect(pymupdf.Rect(b[1:5]) + (-1.5, -1.5, 1.5, 1.5), color=None, fill=HIGHLIGHT, fill_opacity=0.35, overlay=True)
    return page.get_pixmap(dpi=dpi).tobytes("png")


def render_crop(pdf: bytes, boxes: list[list[float]], dpi: int = 150, pad: float = 30) -> bytes:
    """Crop around a sentence (first page it appears on), full page width, with context above/below."""
    if not boxes:
        raise ValueError("no boxes")
    page_no = int(boxes[0][0])
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    page = doc[page_no - 1]
    rects = [pymupdf.Rect(b[1:5]) for b in boxes if int(b[0]) == page_no]
    for r in rects:
        page.draw_rect(r + (-1.5, -1.5, 1.5, 1.5), color=None, fill=HIGHLIGHT, fill_opacity=0.35, overlay=True)
    u = rects[0]
    for r in rects[1:]:
        u |= r
    clip = pymupdf.Rect(page.rect.x0 + 36, max(page.rect.y0, u.y0 - pad), page.rect.x1 - 36, min(page.rect.y1, u.y1 + pad))
    return page.get_pixmap(dpi=dpi, clip=clip).tobytes("png")
