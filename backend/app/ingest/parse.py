"""PDF -> clauses -> sentences with exact bboxes; tables row-wise with header repeated (plan Q1).

Born-digital pages are read from their text layer. A scanned page (no text layer) is read with Tesseract OCR through
PyMuPDF (English + Hindi), which yields the same rawdict structure in page coordinates, so clauses, citations and
highlights work the same way. Geometry comes from PyMuPDF rawdict (per-char bboxes), so each sentence's highlight
rectangles are exact, per line.
"""

import functools
import logging
import os
import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from app.core.normalise import extract_values

log = logging.getLogger(__name__)
OCR_LANGS = os.environ.get("OCR_LANGS", "eng+hin")
OCR_DPI = int(os.environ.get("OCR_DPI", "300"))


@functools.cache
def ocr_tessdata() -> str | None:
    """Tesseract's language folder, or None when OCR isn't installed (scanned pages are then reported, not read)."""
    try:
        return pymupdf.get_tessdata()
    except Exception:
        return None


def _needs_ocr(page: pymupdf.Page) -> bool:
    """A page with images but (almost) no text layer: a scan or a photo of a page."""
    return len(page.get_text("text").strip()) < 20 and bool(page.get_images(full=False))


# bbox entries are [page, x0, y0, x1, y1] (page 1-based, PDF points)
BBox = list[float]


@dataclass
class PSentence:
    page: int
    text: str
    bboxes: list[BBox]
    is_table_row: bool = False


@dataclass
class PClause:
    ref: str
    heading_path: str
    parent_ref: str | None
    page_start: int
    sentences: list[PSentence] = field(default_factory=list)

    @property
    def page_end(self) -> int:
        return max((s.page for s in self.sentences), default=self.page_start)

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.sentences)


@dataclass
class PDoc:
    title: str
    page_count: int
    circular_no: str | None
    issue_date: str | None
    doc_type: str
    clauses: list[PClause]
    ocr_pages: list[int] = field(default_factory=list)  # 1-based pages read with OCR
    unread_pages: list[int] = field(default_factory=list)  # scanned pages that could not be read (no OCR installed)
    hidden_ignored: int = 0  # S2: text spans a reader cannot see, left out
    suspicious_ignored: int = 0  # S2: sentences written as instructions to an AI, left out


@dataclass
class _Line:
    page: int
    text: str
    chars: list[tuple[str, tuple[float, float, float, float]]]
    size: float
    bold: bool
    y0: float
    x0: float
    first_in_block: bool = False


# ---------------------------------------------------------------- regexes
_NUM_CLAUSE = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){0,3}[A-Z]?)([.)]?)\s+(?=\S)")
_SUB_CLAUSE = re.compile(r"^\(([a-z]{1,2}|[ivx]{1,4}|\d{1,2})\)\s+")
_ANNEX = re.compile(r"^(Annex(?:ure)?|Schedule|Appendix)\s+([0-9IVX]+|[A-Z])\b[\s:.\-–—]*", re.IGNORECASE)
_PAGE_NO = re.compile(r"^(page\s*)?\d+(\s*(of|/)\s*\d+)?$", re.IGNORECASE)
_CIRCULAR = re.compile(
    r"(?:Circular|Ref(?:erence)?|Notification|Master\s+Direction)\s*No\.?\s*[:.\-]?\s*([A-Z0-9][\w./-]*\d[\w./-]*)",
    re.IGNORECASE,
)
_SLASH_ID = re.compile(r"\b([A-Z]{2,}(?:/[A-Za-z0-9.-]+){2,})\b")
_ABBREV = {"rs", "no", "nos", "pa", "p.a", "e.g", "i.e", "viz", "sr", "dr", "mr", "ms", "mrs", "st", "w.e.f", "etc",
           "para", "cl", "sec", "vs", "ltd", "pvt", "co", "inr", "approx", "art", "fig", "max", "min", "p.m"}
_CELL_FLAGS = pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES  # "ﬁ" -> "fi" so search matches
_SENT_END = re.compile(r"[.;?!](?=\s+[A-Z0-9(“\"‘₹])")


# control characters other than tab/newline/CR (NUL in particular can't be stored in a Postgres text column)
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


# ---------------------------------------------------------------- S2: text a person reading the PDF cannot see
# A PDF can carry text that is in the text layer but not on the page: white on white, invisible render mode, zero
# opacity, a 0.5 pt font, or covered by a filled box. A reader never sees it, a parser reads it, and a model given it
# might obey it ("Ignore previous instructions..."). Such spans are redacted from the in-memory copy before anything
# is read from the page (lines, tables, title), so they reach neither the index nor the model.
_TINY_PT = 1.5  # font size below which text is unreadable
_MIN_CONTRAST = 40  # grey levels (0-255) between the darkest and lightest pixel under a span: less = nothing visible
_CHECK_DPI = 96


def _span_text(span: dict) -> str:
    return "".join(c["c"] for c in span.get("chars", ()))


def _flat(pix: pymupdf.Pixmap, r: pymupdf.Rect, origin: pymupdf.Point, scale: float) -> bool:
    """True when the rendered page shows (almost) nothing under this span: no ink of a different shade there."""
    x0, x1 = max(0, int((r.x0 - origin.x) * scale)), min(pix.width, int((r.x1 - origin.x) * scale) + 1)
    y0, y1 = max(0, int((r.y0 - origin.y) * scale)), min(pix.height, int((r.y1 - origin.y) * scale) + 1)
    if x1 - x0 < 1 or y1 - y0 < 1:
        return True
    buf, stride, n = pix.samples_mv, pix.stride, pix.n
    lo, hi = 255, 0
    for y in range(y0, y1):
        row = bytes(buf[y * stride + x0 * n: y * stride + x1 * n: n])
        lo, hi = min(lo, min(row)), max(hi, max(row))
        if hi - lo >= _MIN_CONTRAST:
            return False
    return True


def _hidden_spans(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, str]]:
    raw = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT)
    spans = [(sp, pymupdf.Rect(sp["bbox"])) for b in raw["blocks"] for ln in b.get("lines", ()) for sp in ln["spans"]
             if _span_text(sp).strip()]
    if not spans:
        return []
    images = [pymupdf.Rect(i["bbox"]) for i in page.get_image_info()]
    pix, out = None, []
    for sp, r in spans:
        if sp.get("alpha", 255) == 0:  # invisible render mode (3) or a fully transparent fill
            # over an image it is a scanned page's OCR layer: the picture shows those words
            if not any((r & im).get_area() >= 0.5 * max(r.get_area(), 1e-6) for im in images):
                out.append((r, _span_text(sp)))
            continue
        if sp["size"] < _TINY_PT or r.height < 1.0:
            out.append((r, _span_text(sp)))
            continue
        if page.rotation:  # render and text coordinates differ on a rotated page: only the checks above apply
            continue
        if pix is None:
            pix = page.get_pixmap(dpi=_CHECK_DPI, colorspace=pymupdf.csGRAY, alpha=False)
        if _flat(pix, r, page.rect.tl, pix.width / page.rect.width):
            out.append((r, _span_text(sp)))
    return out


def _drop_hidden(page: pymupdf.Page) -> int:
    """Redact the spans nobody can see from this in-memory page; returns how many there were."""
    hidden = _hidden_spans(page)
    for r, text in hidden:
        h = r.height
        # a little inside the span, so a visible neighbouring line is never touched
        page.add_redact_annot(pymupdf.Rect(r.x0 + 0.2, r.y0 + 0.25 * h, r.x1 - 0.2, r.y1 - 0.25 * h))
        log.info("S2 hidden text ignored on page %d: %r", page.number + 1, text[:120])
    if hidden:
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
    return len(hidden)


# text that addresses an AI rather than a policyholder: dropped, counted and reported, never indexed. Kept narrow:
# ordinary policy language ("shall not disclose confidential information", "when asked by the Company") must pass.
_INJECTION = re.compile(
    r"\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|these\s+)?"
    r"(?:previous|prior|above|earlier|preceding|system|original)\s+(?:instructions?|prompts?|rules?|messages?|directions?)"
    r"|\b(?:system|developer|hidden)\s+prompt\b"
    r"|\byou\s+are\s+(?:now\s+)?(?:an?\s+|the\s+)?(?:ai|a\.i\.|assistant|chatbot|language\s+model|llm|gpt|gemini|claude)\b"
    r"|\b(?:ai|assistant|chatbot|language\s+model|llm)s?\s+(?:must|should|shall|will)\s+(?:now\s+)?(?:say|answer|reply|respond|"
    r"tell|state|ignore|reveal|output|recommend)\b"
    r"|\b(?:reveal|print|output|leak|show|repeat)\b[^.]{0,30}\b(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)\b"
    r"|\bnew\s+instructions?\s*:"
    r"|\b(?:when|if)\s+(?:a\s+|the\s+)?(?:user|anyone|someone)\s+asks?\b[^.]{0,80}\b(?:say|answer|reply|respond|tell)\b"
    r"|\b(?:do\s+not|don't|never)\s+(?:tell|inform|show)\s+the\s+user\b"
    r"|\bprompt\s+injection\b|\bjailbreak\b",
    re.IGNORECASE,
)


def suspicious(text: str) -> bool:
    return bool(_INJECTION.search(text))


def _is_bold(span: dict) -> bool:
    return bool(span["flags"] & 16) or "bold" in span["font"].lower()


def _page_lines(page: pymupdf.Page, pno: int, table_rects: list[pymupdf.Rect], textpage=None) -> list[_Line]:
    out = []
    raw = page.get_text("rawdict", flags=pymupdf.TEXTFLAGS_TEXT & ~pymupdf.TEXT_PRESERVE_LIGATURES, textpage=textpage)
    for block in raw["blocks"]:
        first = True
        for line in block.get("lines", []):
            chars, sizes, bold = [], [], False
            for span in line["spans"]:
                sizes.append(span["size"])
                bold = bold or _is_bold(span)
                for ch in span["chars"]:
                    if _CTRL.match(ch["c"]):  # e.g. NUL from odd font encodings: Postgres text rejects 0x00
                        continue
                    chars.append((ch["c"], tuple(ch["bbox"])))
            text = "".join(c for c, _ in chars)
            if not text.strip():
                continue
            lb = pymupdf.Rect(line["bbox"])
            centre = pymupdf.Point((lb.x0 + lb.x1) / 2, (lb.y0 + lb.y1) / 2)
            if any(centre in r for r in table_rects):
                continue
            # trim leading/trailing whitespace chars, keep geometry aligned
            while chars and chars[0][0].isspace():
                chars.pop(0)
            while chars and chars[-1][0].isspace():
                chars.pop()
            out.append(_Line(pno, "".join(c for c, _ in chars), chars, max(sizes), bold, lb.y0, lb.x0, first))
            first = False
    return out


def _margin_noise(doc: pymupdf.Document, lines_by_page: list[list[_Line]]) -> set[tuple[int, str]]:
    """Repeated headers/footers and page numbers in the top/bottom 8% of pages."""
    counts: Counter[str] = Counter()
    candidates = []
    for pno, lines in enumerate(lines_by_page):
        h = doc[pno].rect.height
        for ln in lines:
            if ln.y0 < 0.08 * h or ln.y0 > 0.92 * h:
                key = re.sub(r"\d+", "#", ln.text.strip().lower())
                counts[key] += 1
                candidates.append((pno, ln, key))
    n = len(lines_by_page)
    noise = set()
    for pno, ln, key in candidates:
        if _PAGE_NO.match(ln.text.strip()) or (n > 1 and counts[key] >= max(2, n // 2)):
            noise.add((pno, ln.text))
    return noise


class _Builder:
    """Accumulates clause text + per-char geometry, then splits into sentences."""

    def __init__(self) -> None:
        self.clauses: list[PClause] = []
        self.cur: PClause | None = None
        self.buf: list[tuple[str, tuple[int, int, tuple[float, ...]] | None]] = []  # (char, (page, line_id, bbox))
        self.line_id = 0

    def start(self, ref: str, heading: str, parent: str | None, page: int) -> None:
        self.flush()
        self.cur = PClause(ref, heading, parent, page)
        self.clauses.append(self.cur)

    def add_line(self, ln: _Line, skip_chars: int = 0) -> None:
        if self.cur is None:
            self.start("_preamble", "", None, ln.page)
        chars = ln.chars[skip_chars:]
        while chars and chars[0][0].isspace():
            chars = chars[1:]
        if not chars:
            return
        if self.buf:
            prev = self.buf[-1][0]
            if prev == "-" and chars[0][0].islower():
                self.buf.pop()  # de-hyphenate across line break
            else:
                self.buf.append((" ", None))
        self.line_id += 1
        for c, bb in chars:
            self.buf.append((c, (ln.page, self.line_id, bb)))

    def add_table_row(self, page: int, text: str, bbox: tuple[float, float, float, float]) -> None:
        if self.cur is None:
            self.start("_preamble", "", None, page)
        self.flush()
        self.cur.sentences.append(PSentence(page, text, [[page, *map(round2, bbox)]], True))

    def flush(self) -> None:
        if not self.buf or self.cur is None:
            self.buf = []
            return
        text = "".join(c for c, _ in self.buf)
        start = 0
        for m in _SENT_END.finditer(text):
            end = m.end()
            token = re.findall(r"[\w.₹]+$", text[start:end - 1].strip())
            if token and token[0].lower().rstrip(".") in _ABBREV:
                continue
            if re.search(r"\d\.$", text[start:end]) and re.match(r"\s+\d", text[end:]):
                continue  # decimal / clause number, not a boundary
            self._emit(start, end)
            start = end
        self._emit(start, len(text))
        self.buf = []

    def _emit(self, a: int, b: int) -> None:
        seg = self.buf[a:b]
        text = "".join(c for c, _ in seg).strip()
        if len(text) < 2:
            return
        boxes: dict[tuple[int, int], list[float]] = {}
        for _, geo in seg:
            if geo is None:
                continue
            page, lid, (x0, y0, x1, y1) = geo
            r = boxes.get((page, lid))
            boxes[(page, lid)] = [min(r[0], x0), min(r[1], y0), max(r[2], x1), max(r[3], y1)] if r else [x0, y0, x1, y1]
        bbs = [[p, *map(round2, r)] for (p, _), r in boxes.items()]
        page = bbs[0][0] if bbs else self.cur.page_start
        self.cur.sentences.append(PSentence(int(page), text, bbs))


def round2(x: float) -> float:
    return round(float(x), 2)


def _clean_cell(c: str | None) -> str:
    c = _CTRL.sub("", c or "")
    c = re.sub(r"(?<=\w)-\s*\n\s*(?=\w)", "-", c)  # wrapped "no-" + "dues" -> "no-dues"
    return re.sub(r"\s+", " ", c).strip()


def _guess_type(title: str) -> str:
    t = title.lower()
    for key, typ in [("circular", "circular"), ("amendment", "circular"), ("notification", "circular"),
                     ("key facts", "kfs"), ("master", "master"), ("policy wording", "policy"),
                     ("schedule", "schedule"), ("agreement", "contract"), ("contract", "contract"),
                     ("policy", "policy")]:
        if key in t:
            return typ
    return "other"


def parse_pdf(data: bytes) -> PDoc:
    doc = pymupdf.open(stream=data, filetype="pdf")
    tables_by_page, lines_by_page = [], []
    ocr_pages, unread = [], []
    hidden = 0
    for pno, page in enumerate(doc):
        if not _needs_ocr(page):
            try:
                hidden += _drop_hidden(page)
            except Exception as e:  # the check never fails a document; it is logged
                log.warning("hidden-text check failed on page %d: %s", pno + 1, e)
        if _needs_ocr(page):
            tess = ocr_tessdata()
            if tess is None:
                unread.append(pno + 1)
                tables_by_page.append([])
                lines_by_page.append([])
                continue
            try:
                tp = page.get_textpage_ocr(language=OCR_LANGS, dpi=OCR_DPI, full=True, tessdata=tess)
                lines_by_page.append(_page_lines(page, pno + 1, [], textpage=tp))
                ocr_pages.append(pno + 1)
            except Exception as e:  # one bad page never fails the document
                log.warning("OCR failed on page %d: %s", pno + 1, e)
                lines_by_page.append([])
                unread.append(pno + 1)
            tables_by_page.append([])  # table finding needs a text layer; OCR rows still read as lines
            continue
        tabs = []
        try:
            for t in page.find_tables().tables:
                tabs.append({
                    "bbox": tuple(t.bbox),
                    "header": list(t.header.names or []),
                    "external": bool(t.header.external),
                    # clip-based cell text keeps word spacing (t.extract() can drop spaces)
                    "rows": [[page.get_text("text", clip=c, flags=_CELL_FLAGS) if c else "" for c in r.cells] for r in t.rows],
                    "row_bboxes": [tuple(r.bbox) for r in t.rows],
                })
        except Exception:  # table finder is heuristic; never fail ingestion on it
            tabs = []
        tables_by_page.append(tabs)
        lines_by_page.append(_page_lines(page, pno + 1, [pymupdf.Rect(t["bbox"]) for t in tabs]))

    noise = _margin_noise(doc, lines_by_page)
    body_sizes = Counter(round(ln.size) for lines in lines_by_page for ln in lines)
    body = body_sizes.most_common(1)[0][0] if body_sizes else 10

    b = _Builder()
    section = annex = ""
    last_num_ref: str | None = None
    prev_header: list[str] | None = None
    prev_table_clause: PClause | None = None

    for pno, page in enumerate(doc):
        items: list[tuple[float, str, object]] = [(ln.y0, "line", ln) for ln in lines_by_page[pno] if (pno, ln.text) not in noise]
        items += [(t["bbox"][1], "table", t) for t in tables_by_page[pno]]
        items.sort(key=lambda it: it[0])
        left = min((ln.x0 for ln in lines_by_page[pno]), default=0)
        prev_end = "."
        for _, kind, obj in items:
            if kind == "table":
                rows = obj["rows"]
                external = obj["external"]
                header = [_clean_cell(h) for h in (rows[0] if rows and not external else obj["header"])]
                offset = 0 if external else 1
                # continuation across a page break: still inside the clause of the previous table, same column
                # count, header not repeated -> reuse previous header, every row is data
                same_clause = prev_table_clause is not None and prev_table_clause is b.cur
                if same_clause and prev_header and len(header) == len(prev_header) and header != prev_header:
                    header, offset = prev_header, 0
                data_rows = rows[offset:]
                if not header or not any(header):
                    header = [f"col{i + 1}" for i in range(len(rows[0]) if rows else 0)]
                prev_header, prev_table_clause = header, b.cur
                caption = " / ".join(x for x in [annex or section, b.cur.ref if b.cur else ""] if x)
                for i, row in enumerate(data_rows):
                    cells = [_clean_cell(c) for c in row]
                    if not any(cells):
                        continue
                    pairs = " | ".join(f"{h}: {v}" for h, v in zip(header, cells) if v)
                    ridx = i + offset
                    rb = obj["row_bboxes"][ridx] if ridx < len(obj["row_bboxes"]) else obj["bbox"]
                    b.add_table_row(pno + 1, f"[{caption}] {pairs}" if caption else pairs, rb)
                continue

            ln: _Line = obj  # type: ignore[assignment]
            text = ln.text
            is_heading_style = (ln.bold or ln.size >= body * 1.15) and len(text) < 90

            # a clause marker only counts at a line start near the left margin after a finished line
            can_start = (ln.x0 <= left + 40) and (prev_end in ".:;" or is_heading_style or prev_end == "" or ln.first_in_block)
            ended = prev_end
            prev_end = text.rstrip()[-1:] if not is_heading_style else ":"
            m_annex = _ANNEX.match(text) if can_start else None
            m_num = _NUM_CLAUSE.match(text) if can_start else None
            m_sub = _SUB_CLAUSE.match(text) if (can_start or ended in ":;") else None
            if m_num and "." not in m_num.group(1) and not is_heading_style and not m_num.group(2):
                m_num = None  # "30 days of ..." on a wrapped line is not clause 30
            if m_annex and is_heading_style:
                annex = f"{m_annex.group(1).title()} {m_annex.group(2)}"
                rest = text[m_annex.end():].strip()
                if rest:
                    annex = f"{annex}: {rest}"
                b.start(f"{m_annex.group(1).title()} {m_annex.group(2)}", annex, None, pno + 1)
                last_num_ref = None
                continue
            if m_num:
                ref = m_num.group(1)
                title = text[m_num.end():].strip()
                if "." not in ref and is_heading_style:  # "7. Prepayment" -> section heading + clause
                    section = f"{ref}. {title}"
                    annex = ""
                    b.start(ref, section, None, pno + 1)
                    last_num_ref = ref
                    continue
                parent = ref.rsplit(".", 1)[0] if "." in ref else None
                b.start(ref, " > ".join(x for x in [annex, section] if x), parent, pno + 1)
                b.add_line(ln, m_num.end())
                last_num_ref = ref
                continue
            if m_sub and last_num_ref:
                ref = f"{last_num_ref.split('(')[0]}({m_sub.group(1)})"
                b.start(ref, " > ".join(x for x in [annex, section] if x), last_num_ref.split("(")[0], pno + 1)
                b.add_line(ln, m_sub.end())
                continue
            if is_heading_style and not text.rstrip().endswith((".", ";", ",")) and b.cur and b.cur.ref == "_preamble":
                b.add_line(ln)  # title lines stay in the preamble (used for metadata)
                continue
            b.add_line(ln)
    b.flush()

    flagged = 0
    for c in b.clauses:
        keep = [s for s in c.sentences if not suspicious(s.text)]
        for s in c.sentences:
            if s not in keep:
                log.info("S2 suspicious text ignored: %r", s.text[:200])
        flagged += len(c.sentences) - len(keep)
        c.sentences = keep
    clauses = [c for c in b.clauses if c.sentences]
    page1 = [ln for ln in lines_by_page[0] if (0, ln.text) not in noise] if lines_by_page else []
    title = _title(page1)
    first_text = " ".join(ln.text for lns in lines_by_page[:1] for ln in lns)
    m = _CIRCULAR.search(first_text) or _SLASH_ID.search(first_text)
    circ = m.group(1) if m else None
    dates = [v.value for v in extract_values(first_text) if v.type == "date"]
    return PDoc(
        title=title or "Untitled document",
        page_count=len(doc),
        circular_no=circ,
        issue_date=str(dates[0]) if dates else None,
        doc_type=_guess_type(title),
        clauses=clauses, ocr_pages=ocr_pages, unread_pages=unread, hidden_ignored=hidden, suspicious_ignored=flagged)


def _title(lines: list[_Line]) -> str:
    if not lines:
        return ""
    top = [ln for ln in lines[:15]]
    biggest = max(ln.size for ln in top)
    parts = [ln.text.strip() for ln in top if abs(ln.size - biggest) < 0.6]
    return " ".join(parts)[:200]
