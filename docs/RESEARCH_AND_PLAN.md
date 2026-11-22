# Zero-Guessing Document AI: Research Report and 30-Hour Build Plan

> ## ⚠️ Revision 4 (current): production backend on Gemini. **Section L overrides everything that conflicts with it.**
> The team decided to use the **Gemini API only** for all model calls, and to build a **production FastAPI backend first** (frontend later). This replaces the local-model choices in Q2–Q5 and Q12, the VRAM/RAM budget, Streamlit (Q9), SQLite (C.2), C.5 and D.
>
> Still valid from the earlier sections: the verification design (Q5 definitions, algorithm, normaliser), contradictions (Q6), amendments (Q7), abstention (Q8), the corpus (Q10), eval (Q11), the JSON schemas (C.3), and Sections J–K.
>
> **Open risk to raise at mid-evaluation:** the PS asks for "open-source models without any paid AI API". The key being free doesn't make Gemini open-source. Gemini free-tier inputs may also be used by Google and seen by human reviewers. All LLM access goes through one module (`app/llm/`), so switching back to local models is a config change.

Prepared 2026-11-23. Target: Windows 11 laptop, RTX 4060 Laptop (8 GB VRAM, checked with `nvidia-smi`: 8188 MiB, driver 610.91), 16 GB RAM, one builder.
Environment as found: empty git repo, Python 3.13.0, Ollama 0.17.1 installed.

Confidence tags: **[V]** checked against a primary or near-primary source in this session. **[M]** from my own knowledge (cutoff mid-2026), not re-checked. **[E]** my estimate, to be measured in the bake-offs.

> **Revision 2 (2026-11-23, after a critical review).** What changed:
> - **Build order:** a crude end-to-end version runs in the browser by hour 8.5. Previously the UI started at hour 20.
> - **Amendments:** actions reduced to substitute / insert / delete / withdraw. No in-text value replacement, no rebuilding parent text from sub-clauses.
> - **Contradictions:** a non-numeric path for rule and eligibility conflicts. The ingestion-time scan moves from Stage 3 to Stage 2, so it can feed proactive alerts.
> - **Corpus and demo:** the corpus gets a rule/eligibility contradiction. The calculation demo no longer depends on an operand that is part of a planted conflict. The demo is trimmed to 5 live questions plus a clearly labelled pre-run panel.
> - **Verifier:** the normaliser ignores clause and document references. NLI defaults to the base model. The reranker is off by default.
> - **Checkpoints:** cut-lines added for amendments and contradictions.
> - **New features:** hover previews of cited passages (Stage 2), a feedback log with a human-reviewed improvement loop (Stage 2), and voice input/output (Stage 3).
> - **Section J (new)** reviews the team's original idea list, voice, self-learning and E-means.
>
> Superseded text has been replaced in place, not kept alongside.
>
> **Revision 3 (2026-11-23, four requested features, see Section K).**
> - **Camera input:** photograph a printed clause or question; local OCR turns it into editable text. It also enables a "check this clause" mode. Stage 3.
> - **Edit and resend prompts:** ChatGPT-style, with answer versions kept per turn. Stage 2.
> - **Document Library:** every document in one place, with its upload time and status. Stage 1/2.
> - **Shareable chat links:** a read-only snapshot behind a secret token, plus a self-contained HTML export. A true public internet link is an opt-in tunnel, off by default.
> - **Paid for by:** voice moves to last place in Stage 3, the feedback log moves to Stage 3, and the final buffer shrinks by 30 minutes.

---

## A. Executive summary

**Stack:** PyMuPDF (parse, bboxes, tables, page render) → SQLite (clauses, sentences, amendments) + numpy dense index (bge-m3, CPU) + BM25 (`bm25s`) fused with RRF → (optional) bge-reranker-v2-m3, **off by default**, switched on only if it raises recall@5 by ≥5 points → **Qwen3.5-9B-Instruct Q4_K_M via Ollama** with JSON-schema-constrained output and thinking turned off (fallback: Qwen3.5-4B / Gemma 4 E4B) → deterministic + NLI claim verifier (DeBERTa-v3-**base** NLI on CPU; large only if measured fast enough) → Streamlit UI with hover previews of cited passages.

**Architecture in one sentence:** retrieve sentence-addressed evidence, have the LLM draft atomic claims that cite evidence **IDs** (it never retypes quotes), then verify each claim deterministically (citation exists, numbers match, clause not superseded as of a chosen date) and with NLI, block what fails, and score faithfulness on the draft.

**The main change from the prior review:** the LLM cites sentence IDs such as `e17` and does not copy quotes. Every quote is then verbatim by construction, there are far fewer output tokens (the biggest latency cost), and the highlight bbox is a lookup. The fuzzy quote match from finding 1a becomes a safety net that is not needed on the main path.

**Top 3 risks**
1. **LLM latency and VRAM on the laptop.** A 9B model plus a reranker may not fit in 8 GB together. A bake-off in hour 1 decides between 9B and 4B and where the reranker runs.
2. **Over-abstention.** A strict verifier blocks correct but paraphrased claims. Tune the thresholds on the gold set, and allow "supported by number match plus high NLI" paths.
3. **Amendment extraction on an unseen judge PDF.** Use regex triggers and an LLM extraction step, and always show a confirm/edit table. Set expectations in the demo.

---

## B. Research findings Q1–Q12

### Q1. PDF parsing

| Candidate | Tables | Headings/structure | BBoxes | Speed / resources | Windows | Licence |
|---|---|---|---|---|---|---|
| **PyMuPDF (+ `find_tables`, pymupdf4llm)** | Good on ruled, born-digital tables; weaker on borderless ones | Font-size/bold heuristics; you write the clause-number regex | Word, line and block level, exact | Very fast, CPU only, ~50 MB | pip wheel, no pain | **AGPL-3.0** (fine for an open-source hackathon repo) [M] |
| Docling | Strongest table structure (TableFormer); one comparison reports TEDS 0.93 for docling 2.110 [V: Nutrient write-up] | Good layout model | Yes (provenance bboxes) | Pulls in torch and layout models, ~1–3 s/page on CPU [E]; competes for VRAM if on GPU | Works on Windows, heavy install [M] | MIT [M] |
| pdfplumber | Good with explicit settings, manual tuning | None | Char/word level | Slower than PyMuPDF, CPU | Easy | MIT |
| Marker / Unstructured / Camelot | Marker is GPU-heavy; Unstructured is a heavy dependency tree; Camelot handles lattice tables only and needs Ghostscript | — | partial | — | Camelot/Ghostscript are painful on Windows | GPL (Marker) / Apache / MIT |

**Recommendation: PyMuPDF.** We author the demo PDFs, so tables are ruled and the text layer is clean. Clause numbering ("7.2", "7.2A", "(b)") comes from our regex either way. PyMuPDF also renders pages for the highlighting feature, so one library covers parse, bboxes and render. **Fallback:** Docling, for table extraction only, if the bake-off shows `find_tables` misses rows or splits multi-page tables badly. Run it at ingestion only, on CPU, so it never competes with the LLM. **Confidence: high** for our own corpus, medium for unseen judge PDFs.

**1-hour bake-off (hour 3.5, on our own PDFs and one real RBI PDF):**
1. Run PyMuPDF `page.find_tables()` and Docling over the 3 table-heavy pages, including a table that spans a page break.
2. Score: every fee-table cell present and correct (we know the ground truth because we wrote it), header detected, continuation rows joined, and bbox inside the cell on a rendered overlay.
3. **Decision rule:** keep PyMuPDF if it gets ≥95% of cells right and handles the multi-page join with ≤20 lines of stitching code. Otherwise use Docling for tables only and PyMuPDF for everything else.

### Q2. Local LLM and runtime

| Candidate | Size at Q4_K_M | JSON / instruction following | Hindi | Context | Laptop 4060 speed | Licence |
|---|---|---|---|---|---|---|
| **Qwen3.5-9B** (released 2026-03-02) [V] | ~5.6 GB file [V: blog, unverified on HF] | Strong; most-cited 8 GB pick in 2026 roundups [V: several blogs, weak evidence] | Good [M] | 262K native [V: Artificial Analysis] (we use 8K) | ~30–40 tok/s generation [E] | Apache-2.0 [V for the 0.8B card; assume the same for 9B, check] |
| Qwen3.5-4B | ~2.7 GB [E] | Good, more format slips | OK | 262K | ~60–80 tok/s [E] | Apache-2.0 |
| Gemma 4 E4B (2026-04-02) [V] | ~3 GB [V: blog] | Good | Trained on 140+ languages, so likely strong; Hindi not confirmed by name [V] | 128K [V] | ~55–70 tok/s [E] | Apache-2.0 [V] |
| Gemma 4 12B | ~7 GB [V: blog] | Better | Good | 256K | Doesn't fit next to anything else | Apache-2.0 |

Notes:
- Qwen3.5 has a hybrid thinking/non-thinking mode [V]. **Turn thinking off** (`think: false` in Ollama, or `/no_think`). Otherwise latency doubles and the JSON constraint fights the reasoning text.
- The Qwen3.5 small models are "native multimodal" [V]. Check that the Ollama tag doesn't load a vision projector you don't need (it wastes VRAM). If it does, use a text-only GGUF from HF via `ollama create`.
- One source says only 8 of 32 layers use full attention, which keeps the KV cache small [V: blog only]. If true, an 8K context costs little.

**Runtime: Ollama** (native Windows, already installed, `format: <JSON schema>` for constrained decoding [V: docs.ollama.com/capabilities/structured-outputs], `keep_alive: -1` keeps the model resident). **Check in hour 0:** `ollama pull qwen3.5:9b` works on 0.17.1. If not, upgrade Ollama. **Fallback:** the llama.cpp `llama-server` Windows CUDA release binary with `--json-schema` / GBNF. vLLM is Linux-only, so skip it. ExLlamaV2 doesn't add enough here to justify it. LM Studio is fine but harder to script.

JSON enforcement: schema in `format`, temperature 0, short keys, schema validated with Pydantic, **one** repair retry, then a graceful "draft failed" abstention. The docs say models can still emit preamble, so parse defensively [V].

**One model or several?** Use **one model** for drafting, amendment extraction, contradiction confirmation, calculation-operand extraction and Hindi translation. A second LLM doesn't fit in VRAM, and swapping models costs 3–8 s each time [E]. Verification uses a separate *small encoder* (NLI), not a second LLM.

**Recommendation:** Qwen3.5-9B Q4_K_M. **Fallback:** Qwen3.5-4B Q4_K_M (or Gemma 4 E4B if its Hindi is clearly better). **Confidence: medium.** Decide by bake-off.

**LLM bake-off (hour 0–1, while the corpus downloads):** 8 prompts. Use the real draft schema with 2 evidence blocks, 1 amendment extraction, 1 Hindi translation, and 1 "not in evidence" trap. Measure (a) schema-valid rate, (b) citing an ID that supports the claim, (c) abstaining on the trap, (d) tok/s and peak VRAM in `nvidia-smi` at `num_ctx` 8192.
**Decision rule:** take 9B if it's ≥25 tok/s, peak VRAM ≤6.6 GB, and it is not worse on (a)–(c). Otherwise take 4B. If 4B is chosen, move the reranker to the GPU.

### VRAM and RAM budget [E, measure in hour 1]

| Component | Where | VRAM | System RAM |
|---|---|---|---|
| Windows 11 + Edge (demo tab) + VS Code | — | ~0.2–0.4 GB if the display runs on the iGPU (Optimus); check with `nvidia-smi` | ~5.5 GB |
| Ollama + Qwen3.5-9B Q4_K_M, ctx 8192 | GPU | ~5.6 weights + ~0.3–0.6 KV + ~0.4 compute ≈ **6.3–6.6 GB** | ~0.8 GB |
| bge-m3 (568M) for queries; corpus embedded once at ingestion | CPU fp32 | 0 | ~2.3 GB |
| bge-reranker-v2-m3 (568M) | CPU (9B case) / GPU fp16 (4B case) | 0 / ~1.3 GB | ~2.3 GB / ~0.6 GB |
| NLI DeBERTa-v3-large (435M) or base (184M) | CPU | 0 | ~1.8 / ~0.8 GB |
| Python + torch + Streamlit | CPU | — | ~1.0 GB |
| **Total (9B option)** | | **~6.6–7.0 / 8 GB** | **~13.5 GB / 16 GB**: tight. Close Chrome/Discord, and use NLI-base if RAM goes over 14.5 GB |
| **Total (4B option)** | | ~3.3 + 1.3 = ~4.6 GB | ~11.5 GB |

Ways to save RAM: keep the encoders in fp32 on CPU (fp16 on CPU is slow), load one shared bge-m3 instance, and use ONNX/int8 only if RAM runs out. Run a single Python process, with Streamlit importing the pipeline directly and no separate API server.

### Q3. Embedder and vector store

| Embedder | Hindi evidence | Size | Licence |
|---|---|---|---|
| **BAAI/bge-m3** | Hindi-BEIR average nDCG@10 **47.29 vs 39.93** for mE5 [V: arXiv 2408.09437] | 568M, 8K ctx, also gives sparse output | MIT [M] |
| Qwen3-Embedding-0.6B | MMTEB multilingual 70.70 [V: arXiv 2506.05176]; no direct Hindi-legal evidence | 0.6B | Apache-2.0 [M] |
| multilingual-e5-large-instruct | Wins some Indic directions [V: arXiv 2601.10205] | 560M | MIT |

**Recommendation: bge-m3 on CPU at query time** (one query takes ~0.1–0.3 s on CPU [E]). Embed the corpus once on GPU at ingestion, *before* Ollama loads. **Fallback:** Qwen3-Embedding-0.6B. **Confidence: high.**
**Vector store:** a **numpy matrix plus a dot product**. A few thousand 1024-d vectors is ~10 MB, and exact search takes milliseconds. Save the matrix as `.npy` next to SQLite. FAISS, Chroma, LanceDB and sqlite-vec all add dependencies without solving any problem at this size. **Confidence: high.**
**BM25:** `bm25s` (fast, pure Python + scipy) with a tokenizer that keeps clause numbers like "7.2A" and "₹5,000" as tokens. Fuse with RRF (k=60) over top-50 from each.

### Q4. Reranker

| Candidate | Multilingual | Size | GPU fp16, 30 pairs × 384 tok | CPU, 30 pairs | Licence |
|---|---|---|---|---|---|
| **bge-reranker-v2-m3** | Yes | 568M | ~0.3–0.5 s [E] | ~3–6 s [E] | Apache-2.0 [M] |
| jina-reranker-v2-base-multilingual | Yes | 278M | ~0.2 s | ~1.5–3 s | CC-BY-NC [M]: non-commercial, acceptable for a hackathon but flag it |
| mmarco-mMiniLMv2-L12-H384 | Yes | 118M | <0.1 s | ~0.6–1 s | Apache-2.0 [M] |

**Recommendation:** bge-reranker-v2-m3. Put it on the GPU if the 4B LLM is chosen. With 9B, run it on CPU with **20 candidates truncated to 320 tokens** (target ≤2.5 s). If CPU latency is over 3 s, switch to mMiniLM. **Confidence: medium.** No direct Hindi rerank benchmark was found [V: search was empty]. Measure it on our gold set (recall@5 with and without the reranker). If the reranker doesn't raise recall@5 by ≥5 points on our small corpus, **drop it**, since RRF alone may be enough at this corpus size.

### Q5. Claim verifier

| Candidate | Labels | Size | Notes |
|---|---|---|---|
| **MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli** | 3-way (entail/neutral/contradict) | 435M | Strong English NLI; the 3-way output gives us "contradicted" directly. English-only is fine because we verify against English sources [M] |
| DeBERTa-v3-base (same family) | 3-way | 184M | ~3× faster on CPU |
| mDeBERTa-v3-base-xnli-multilingual-nli-2mil7 | 3-way, 100 languages incl. Hindi [V] | 278M | Use only if we ever verify Hindi against Hindi sources. The card itself warns that some high scores are a testing error [V] |
| MiniCheck (RoBERTa-L 355M / Flan-T5-L 770M), Bespoke-MiniCheck-7B | Binary only (supported or not) | — | Built for claim-vs-grounding-document checks. Bespoke 7B tops LLM-AggreFact [V: Vectara 2505.04847 / llm-aggrefact], but it doesn't fit next to the LLM, and binary output loses "contradicted". Licence unverified |
| HHEM-2.1-open | Binary score | ~110M [V] | Fast. Trained on RAGTruth, so its benchmark scores may be flattered [V] |
| LLM-as-judge (same Qwen) | Any | 0 extra | Adds 1–3 s per claim batch. Correlated with the drafter's own mistakes |

**Recommendation (revised):** start with DeBERTa-v3-**base** NLI on CPU, batched (all claim × cited-sentence pairs in one forward pass). Switch to large only if two things are both true: base's claim-level precision on the gold set is below 0.95, and large scores a batch of ~20 pairs in ≤3 s on this laptop. The reason: on a laptop CPU, large probably takes 3–6 s per batch, and system RAM is already at about 13.5 of 16 GB. Use the LLM judge **only** for the borderline band (see below), with at most 3 claims per question. **Confidence: medium-high.**

Known NLI weaknesses and mitigations:
- **Numbers:** NLI often says "entail" for 2% vs 3%. *Mitigation:* the deterministic numeric check runs first and can veto.
- **Negation / "except" clauses:** *Mitigation:* the premise includes the parent clause heading and the sentence before; claims stay atomic.
- **Long premises:** degrade above ~400 tokens. *Mitigation:* the premise is only the cited sentences (+1 sentence of context). Score each cited sentence and take the max entailment; for a multi-sentence join, also score the concatenation.
- **Table rows as premises:** render a row as "Fee table: Processing fee | Home loan | 1% of loan amount, min ₹5,000, max ₹25,000" before NLI.

**Definitions (per claim):**
- **SUPPORTED:** every cited ID exists and was in the evidence shown to the LLM, AND every number/date/amount in the claim appears in the cited text after normalisation, AND no cited clause is superseded as of the as-of date (or the claim explicitly talks about the historical version), AND NLI P(entail) ≥ τ_e (start at 0.60). OR a calculation claim whose operands are all SUPPORTED and whose arithmetic Python recomputed.
- **CONTRADICTED:** NLI P(contradict) ≥ τ_c (start at 0.50) against the cited text, OR a number in the claim conflicts with a same-type number in the cited sentence (e.g. claim says 30 days, source says 15 days), OR it cites a superseded clause as current.
- **UNSUPPORTED:** everything else: missing or invalid citation, a number not found in the source, or NLI below τ_e without a contradiction.
- **Borderline band:** τ_e − 0.2 ≤ P(entail) < τ_e with numbers matching → send to the LLM judge (yes/no + reason). Agreement → SUPPORTED.

**Verification algorithm (pseudocode):**
```
for claim in draft.claims:
    reasons = []
    ev = [evidence[id] for id in claim.cite if id in evidence]          # (a) citation exists
    if not ev: mark UNSUPPORTED("no valid citation"); continue
    nums_c = normalise_values(claim.text)                                 # (b) numbers
    nums_e = union(normalise_values(e.text) for e in ev)
    missing = [n for n in nums_c if not any(match(n, m) for m in nums_e)]
    conflict = [n for n in missing if exists m in nums_e with same type and same unit]
    for e in ev:                                                          # (d) supersession
        st = clause_status(e.clause_id, as_of)                            # current|superseded|not_yet_effective|withdrawn
        if st != current and not claim.is_historical: reasons += [f"cites {st} clause {e.clause_ref}; see {st.by}"]
    p = nli_batch([(premise(e), claim.text) for e in ev] + [(join(ev), claim.text)])   # (c) entailment
    pe, pc = max(p.entail), max(p.contradict)
    if conflict or pc >= TAU_C or reasons_superseded: CONTRADICTED
    elif missing: UNSUPPORTED(f"value(s) {missing} not in cited text")
    elif pe >= TAU_E: SUPPORTED
    elif pe >= TAU_E - 0.2: SUPPORTED if llm_judge(claim, ev) else UNSUPPORTED
    else: UNSUPPORTED("cited text does not entail claim")
faithfulness = supported / len(draft.claims)          # on the DRAFT, before blocking
```
**Normaliser:** "two per cent" / "2 %" / "2.0 percent" → (pct, 2.0). "Rs. 5,000" / "₹5000" / "INR 5,000/-" / "five thousand rupees" → (inr, 5000). "Rs 1.5 lakh" → 150000, "crore" → 1e7. "30 days" / "thirty (30) days" / "one month" → (days, 30), keeping month as a separate unit to avoid a false match. Dates → ISO via `dateutil` with dayfirst=True (Indian convention). "p.a." / "per annum" / "per month" kept as a rate period. A small word-number dictionary (0–100, hundred, thousand, lakh, crore) is enough; don't add `word2number` unless it's needed.

**Reference stripping (revised; prevents false blocks):** before extracting values from a claim *or* from evidence, remove anything that is a reference rather than a value:
- clause and section references: `(para(graph)?|clause|section|sub-?para|annex(ure)?|schedule|¶)\s*[0-9A-Z.()]+`
- circular and notification numbers: `[A-Z]{2,}/[A-Z]{2,}/\d{4}/\d+` and `No\.\s*[\w./-]+`
- the as-of date that the system itself puts into the prompt.

Without this, "as per clause 7.2, the penalty is 1%" yields the stray value 7.2, which won't be found in the quote, and the claim gets blocked. The unit tests must include this sentence (expected output: only `(pct, 1)`), plus a circular-number case and an "Annex 3" case.

**Threshold tuning:** run the eval set with τ_e ∈ {0.4, 0.5, 0.6, 0.7, 0.8} and τ_c ∈ {0.4, 0.5, 0.6}. For each, compute claim-level precision of SUPPORTED (against hand-labelled claims) and the over-abstention rate (answerable questions where all claims were blocked). Pick the τ_e that gives the lowest over-abstention while precision stays ≥0.95. This takes ~10 min using cached drafts, because NLI reruns alone.

**Challenge to prior finding 1a:** with ID-based citations, the "quote appears in source" check is an ID existence/membership check and is exact. Keep the fuzzy check (`rapidfuzz.partial_ratio` ≥ 92 after normalising whitespace, hyphenation and quotes) only for an optional `q` field, where the LLM narrows the quote to a substring of a long table row or sentence.

**Definition of "sentence" for the faithfulness score:** one draft claim = one rendered sentence. The schema forces atomic claims, and the UI renders each claim as exactly one sentence, so the denominator is unambiguous. The score is computed on the draft *before blocking* (finding 2 agreed), e.g. "7/9 claims supported (78%), 2 blocked".

### Q6. Contradiction detection

**Candidate pairs, bounded (no O(n²)):**
- *Query time:* top-8 reranked evidence chunks give ≤28 pairs. Keep a pair only if (i) the chunks are from different clauses, (ii) the two clauses are **not** linked in the amendment table (directly or through the same chain root), (iii) both contain ≥1 normalised value of the **same type** (pct/inr/days/date/age/count) with **different values**, and (iv) the subject overlaps: cosine(bge-m3) ≥ 0.75 OR the heading paths share a key noun. In practice this leaves 0–3 pairs → one LLM confirm call per pair (short, ~1–2 s each) [E].
- *Non-numeric path (revised):* the PS also lists **rules** and **eligibility conditions**, and these often contain no numbers ("co-borrowers named in the loan agreement are covered" vs "co-borrowers are not covered"). A pair that fails rule (iii) still goes to the LLM confirm step if all three of these hold:
  - cosine similarity ≥ 0.85;
  - the heading paths share a key noun;
  - at least one side contains a polarity or scope cue: *not, no, shall not, only, excluded, mandatory, optional, eligible, ineligible, covered, not covered*.

  At most 3 such pairs per question. Rules (i) and (ii) still apply.
- *Ingestion-time scan (**Stage 2, moved up from Stage 3**, same code; it feeds the proactive Alerts tab, since the deliverable asks for contradiction "alerts", not only answers that mention a conflict):* for each clause, take its kNN top-5 → n·5 pairs → the same filters → LLM confirm. ~300 clauses ≈ 1,500 pairs, ~50 survive the filters, ~2 min of LLM time [E]. Results go in the `contradictions` table and show on an "Alerts" tab, with the non-numeric path included.

**Subject/attribute/value extraction:** deterministic values (regex normaliser). The *subject* comes from the LLM confirm call, which returns `{same_subject, subject, attribute, value_a, value_b, conditions_a, conditions_b, conflict: bool, kind}`. Conditions matter: "2% for floating-rate" vs "3% for fixed-rate" is **not** a conflict. The confirm prompt must be told to compare eligibility conditions.

**Amendment exclusion:** if `amendments` has a row where (source_clause, target_clause) equals the pair in either direction, or both clauses resolve to the same `chain_root`, the pair is supersession, not contradiction. Show it in the amendment timeline instead (finding 3 agreed). One more case: two same-level documents with different dates and no amendment link. Flag that as a contradiction with the hint "B is later-dated, but contains no amendment language, so it isn't treated as superseding." Don't invent an implicit supersession rule.

**Effect on answers:** if a SUPPORTED claim's evidence is part of a confirmed contradiction, downgrade the claim to "CONFLICTED". The UI shows it with both quotes side by side, and the answer states the conflict instead of picking a side.

### Q7. Amendment chains

**Real Indian phrasings** (RBI uses "Amendment Directions" that cite a named Master Direction and list changes "as under" [V: RBI notification page, 2025]). Exact-phrase verification wasn't possible because the search engine ignores quotes. The list below is from my knowledge of RBI/IRDAI drafting [M]:
- "In partial modification of paragraph X of the Master Direction/Circular No. … dated …"
- "paragraph X shall be substituted with the following" / "shall stand substituted" / "is hereby substituted"
- "after paragraph X, the following paragraph shall be inserted, namely" / "a new sub-paragraph X(a) is inserted"
- "paragraph X shall be deleted" / "stands deleted" / "shall be omitted"
- "the circular … stands withdrawn" / "is hereby repealed" / "supersedes the circular … dated …"
- "shall be read as" / "for the words 'A', the words 'B' shall be substituted"
- "with effect from <date>" / "w.e.f. <date>" / "shall come into force from" / "with immediate effect" / "from the date of this circular"

**Regex triggers (detection only, the LLM extracts):**
`(in partial modification of|hereby substituted|shall be substituted|stand[s]? substituted|shall be inserted|is inserted|shall be (deleted|omitted)|stands? (deleted|withdrawn|repealed)|supersed(es|ed)|shall be read as|with effect from|w\.?e\.?f\.?|come into force)`
plus reference capture `(para(graph)?|clause|section|sub-?para)\s*([0-9]+(\.[0-9]+)*[A-Z]?(\([a-z0-9]+\))*)` and document references `(Circular|Master (Direction|Policy)|Notification)\s+No\.?\s*[\w./-]+`.

**Extraction schema:** see C.3. **Resolution logic:**
```
clause_status(clause_key, as_of):           # clause_key = (root_doc, clause_ref)
    events = amendments where target = clause_key and status=confirmed, ordered by (effective_date, issue_date, doc_id)
    version = original clause text; history = [original]
    for ev in events:
        if ev.effective_date > as_of: pending.append(ev); continue          # "not yet effective"
        match ev.action:
          substitute -> version = ev.new_text          # whole clause or whole sub-clause; no in-text value replacement
          insert -> (creates a new clause_key; status current from effective_date)
          delete -> version = None (status deleted)
          withdraw_document -> all clauses of target doc deleted
        history.append(ev)
    return {current_text: version, current_source: last applied ev (or original), history, pending}
```
- **Chains (C amends B, which amended A):** targets are always normalised to the **root clause key**. If C says "para 2 of Circular 1 is substituted", and Circular 1's para 2 itself substituted Master 7.2, resolve C's target through B's row to `(A, 7.2)`. Store `via_amendment_id`, so the timeline shows A 7.2 → B ¶2 → C ¶3.
- **Partial sub-clause changes (simplified):** each sub-clause is its own clause key (`7.2(b)`), so a change to `7.2(b)` leaves `7.2(a)` current. Parent text is **not** rebuilt from its children; the UI shows the changed sub-clause under its parent heading. We write the corpus ourselves and phrase every change as a whole-clause or whole-sub-clause substitution, so the `modify_value` action (string replacement inside a clause) is dropped. This saves 1–2 hours in the hardest block. On an unseen judge PDF that changes only a value inside a clause, the confirm/edit table lets a person enter the substituted text.
- **"Today":** as-of = system date by default, with an **as-of date picker** in the UI. The demo can move the date past a future-dated change and show the answer flip. This is the interpretation I chose for "which version applies today".
- **Retrieval interaction:** superseded clause texts stay indexed (for history questions), but every evidence item carries its status. The draft prompt marks superseded evidence as `[SUPERSEDED by C ¶3 w.e.f. 2026-07-01]`. The *current* text of any clause that comes up in retrieval is injected into the evidence automatically (amendment-aware expansion), so the LLM always sees the current version.

**UI timeline:** a vertical list per clause: `A 7.2 (2025-04-01): "2% of outstanding" → B ¶2 (w.e.f. 2025-11-01): "1%" → C ¶3 (w.e.f. 2026-07-01): "Nil for individuals" ✅ CURRENT → C ¶5 (w.e.f. 2027-01-01): ⏳ NOT YET EFFECTIVE`, each with a citation chip.

### Q8. Abstention logic

Abstain fully when any of these hold:
1. **Retrieval gate:** top rerank score < τ_r (tuned; or top RRF evidence has no BM25 term overlap with the question's key nouns).
2. **The LLM itself says** `answerable: false` (the schema allows it).
3. **All draft claims are blocked.**
4. **Every supporting claim is CONFLICTED.** Then the answer says "the documents conflict" with the side-by-side quotes, which counts as an answer, not a refusal.

Partial answers (some claims blocked) show the supported claims with the blocked ones struck through and a reason.

**Specific "missing evidence" message** (filled by a template, not written by the LLM): *"I don't have proof for: <missing_info from the draft's `missing` field, or the blocked claim's attribute>. Searched: <N> documents, query terms <key terms>. Closest evidence found: <top 2 citations with titles>, which cover <their heading paths> but not <attribute>."* The LLM supplies `missing: ["foreclosure charge for gold loans"]`, and the system adds what was actually searched and found. That part can't be invented.

**Avoiding over-abstention:** (a) the borderline band goes to the LLM judge, (b) number-matched claims with P(entail) ≥ 0.4 get the judge check instead of a block, (c) the evidence context includes the parent clause, (d) track the "over-abstention rate" metric on answerable gold questions and tune it below 10%, (e) one bounded re-retrieval (Stage 3): if a claim is UNSUPPORTED because of a missing value, re-query with claim text + attribute, add the new evidence, and verify again once.

### Q9. Web app

| Option | Build speed (Python dev) | Chips → highlighted page | Struck-through claims, cards, timeline | Upload | Risk |
|---|---|---|---|---|---|
| **Streamlit** | Fastest | `st.button` per chip → `session_state` → render PNG in the right column | Markdown `~~ ~~` / HTML, `st.columns`, `st.expander` | `st.file_uploader` | Rerun model: cache models with `st.cache_resource` or every click reloads them |
| Gradio Blocks | Fast | Doable with `gr.Image` + events | Doable, layout more rigid | Yes | Event wiring gets fiddly for dynamic chip lists |
| FastAPI + HTML/JS (htmx) | Slower (2–4 h more) | Best control (modal, overlay canvas) | Full control | Yes | More code, needs JS comfort |

**Recommendation: Streamlit,** with the pipeline as an importable Python package (`dai/`) and no separate API server. That's one process and less RAM, and you can test from a CLI (`python -m dai.ask "..."`). The skill level here is the placeholder "[FILL IN]", so I assumed comfortable Python and little or no React. **Fallback:** if Streamlit's reruns make the chip → page interaction unbearable, render the highlighted page inside an `st.dialog` (available in current Streamlit) instead of a column. FastAPI only if both fail. **Confidence: high.**
Hover previews (J.1) are rendered as HTML with CSS-only tooltips inside Streamlit, so no JavaScript is needed.

### Q10. Demo corpus

**Generation tool:** write each document as **HTML + CSS (Jinja templates)** and print it to PDF with **Playwright Chromium `page.pdf()`**, using `displayHeaderFooter` and a `footerTemplate` with `<span class="pageNumber">`. This works on Windows (`pip install playwright && playwright install chromium`). Tables with `<thead>` repeat headers across page breaks, which is the realistic multi-page table case. Avoid WeasyPrint (GTK/Pango install on Windows is painful) and docx2pdf (needs MS Word). Fixed widths and font sizes give stable pagination. Number pages and clauses visibly. Add a letterhead, a circular number and a date.

**Corpus (fictional "Sunrise Co-operative Bank" and "Suraksha General Insurance"; fictional names avoid impersonating a real organisation):**

| ID | Document | Pages | Key planted facts |
|---|---|---|---|
| A | *Master Policy on Retail Loans, v1*, issued 2025-04-01 | ~9 | 5.4 max LTV 80%. **7.2 prepayment penalty, floating rate: 2% of outstanding principal.** 7.3 fixed rate: 3%. 8.1 penal charges 2% p.a. over the contracted rate on the overdue instalment (`Schedule I`). 9.1 grievance resolution within **30 days**. **Annex 3 (p.9): "within 21 days"** → *intra-document contradiction*. Schedule I fee table (spans pp.7–8): processing fee 1% min ₹5,000 max ₹25,000, cheque bounce ₹500, etc. 11.2 vendor payments settled within **30 days** of invoice |
| B | *Circular SCB/RL/2025/14*, 2025-10-01 | 2 | "In partial modification of para 7.2 of the Master Policy … shall be substituted: **1%**", w.e.f. 2025-11-01. Inserts 7.2A (no penalty on part-prepayment ≤25% a year) |
| C | *Circular SCB/RL/2026/03*, 2026-06-15 | 2 | "Para 2 of Circular SCB/RL/2025/14 stands substituted: **Nil** for individual borrowers on floating rate", w.e.f. 2026-07-01 (**3-level chain**). Para 5: processing fee cap ₹25,000 → **₹20,000 w.e.f. 2027-01-01** (**future-dated**). Para 6: "para 8.5 of the Master Policy stands deleted" |
| D | *Key Facts Statement – Home Loan* (borrower-facing) | 3 | Loan ₹30,00,000, 9.50% p.a. floating, 240 months (EMI calculation). **Penal charge "24% p.a. on overdue amount"** vs A 8.1 → *cross-doc contradiction #1*. Grievance contact |
| E | *Loan Servicing Platform Services Agreement* (bank ↔ fictional vendor "Kavach Tech") | ~6 | **Bank pays undisputed invoices within 45 days** vs A 11.2 → *cross-doc contradiction #2*. SLA uptime table, service credits 5%/10% (table → calculation) |
| F | *Home Loan Protection Insurance – Policy Wording* | ~6 | **Grace period 30 days** in 4.3. The *Policy Schedule* (separate 1-page doc G) says **15 days** → *cross-doc contradiction #3*. **3.2: "Co-borrowers named in the loan agreement are covered."** Exclusions list, claim documents table |
| G | *Policy Schedule* | 1 | Grace period 15 days (see F). **"Cover: primary borrower only; co-borrowers are not covered."** vs F 3.2 → *rule/eligibility contradiction #4 (no numbers, so it tests the non-numeric path)* |

**Planted gaps (unanswerable):** nothing about gold loans, NRI borrowers, a top-up loan interest rate, or cryptocurrency. Insurance: no clause on pre-existing conditions waiting period beyond "as per schedule", and the schedule doesn't state it.

**Calculation design (revised):** the main calculation demo must not depend on an operand that is part of a planted conflict. The original demo computed a penalty from A 8.1's penal rate, which deliberately conflicts with the KFS's 24%. The verifier would mark that operand CONFLICTED, and the calculation would be blocked on stage. Instead:
- **EMI:** use the KFS's own figures (₹30,00,000, 9.50% p.a., 240 months). None of these are contested.
- **Second calculation:** use an uncontested operand, such as Schedule I's cheque-bounce charge (₹500) or the service credits in E's SLA table.
- **One gold question deliberately asks** for the penal amount using the contested rate. Expected behaviour: "calculated under both clauses (2% p.a. over the contracted rate vs 24% p.a.); the documents conflict, so no single figure is given." Show this in the demo only if rehearsals show it works reliably.

Before generating the PDFs, re-read `FACTS.md` for **unintended** conflicts (for example, the same fee written two ways in two documents). These turn into false alarms that are hard to explain to judges.

**Real documents:** add 1 real RBI circular PDF (for example a recent "Amendment Directions" notification) as proof that real PDFs parse. Licensing: RBI publications are public government documents, but I couldn't verify the RBI site's reuse terms. **Don't commit them to the repo.** Download them with `scripts/fetch_real_docs.py` and cite the URL. Check parseability in the Q1 bake-off (RBI PDFs are generally born-digital).

**Authoring help:** I (Claude, now, as a dev tool, not part of the runtime) can draft all 7 HTML documents and the gold set in one pass. That turns corpus creation from ~3 h into ~1 h of review.

### Q11. Evaluation

**Gold set:** 33 questions in `eval/gold.jsonl`. Fields: `id, q, lang, category, answerable, expected_answer, expected_values[], expected_citations[{doc, clause_ref}], expected_contradiction{a,b}|null, expected_current_source, as_of`.
Mix: 4 single-doc, 4 cross-doc, 4 table lookup, 2 multi-page, 4 amended rule (incl. a historical "what was it in Oct 2025"), 2 future-dated, 5 contradiction (3 numeric cross-doc + 1 rule/eligibility cross-doc + 1 intra-doc), 5 unanswerable (incl. 2 near-miss traps like "gold loan foreclosure"), 3 calculation, 3 Hindi (+1 Hindi unanswerable).

**Metrics (`eval/run_eval.py` writes to the `eval_results` table + CSV):**
- *Answer correctness:* all `expected_values` appear (normalised) in supported claims, and no supported claim contains a conflicting value of the same type.
- *Citation validity:* % of displayed claims whose citations include an expected `(doc, clause_ref)`. Also 100% verbatim by construction, which is worth stating to judges.
- *Faithfulness:* mean draft faithfulness and the distribution.
- *Abstention:* precision = abstained ∧ unanswerable / abstained; recall = abstained ∧ unanswerable / unanswerable; over-abstention = abstained ∧ answerable / answerable.
- *Contradiction recall* = expected pairs flagged / expected pairs; *false conflict rate* on non-contradiction questions.
- *Amendment accuracy* = `current_source` matches expected.
- *Latency:* p50/p95 end-to-end and per stage.
- *Retrieval recall@5/@10* (to decide on the reranker).

**For judges:** an "Eval" tab with a one-line scoreboard (e.g. "Correct 27/32 · Abstention P/R 1.0/1.0 · Contradiction recall 4/4 · p50 14 s"), plus a per-question table with failures listed honestly. Judges trust a visible failure more than a wall of 100%s.

### Q12. Latency estimate (9B option) [E]

| Stage | Time |
|---|---|
| Query embed (CPU) + BM25 + RRF | 0.2–0.4 s |
| Rerank 20 (CPU) / 30 (GPU) | 2–2.5 s / 0.4 s |
| LLM draft: ~3,000 prompt tokens prefill (~1–1.5k tok/s) + ~250 output tokens (ID citations, short keys) at ~35 tok/s | 2–3 s + 7 s ≈ **9–10 s** |
| Verification: NLI batch of ~20 pairs (large, CPU) + numeric + status | 1.5–2.5 s |
| Contradiction confirm (0–2 LLM calls, ~80 output tokens each) | 0–5 s |
| Hindi translation (if needed, ~150 tokens) | +4–5 s |
| **Total** | **~13–20 s English, ~18–25 s Hindi.** The 4B option is roughly 40% faster |

Tactics: pre-ingest everything; keep the LLM resident (`keep_alive: -1`) and warm it up on app start; turn thinking off; short JSON keys and ID citations; stream status ("Retrieving… Drafting… Verifying 4/7…") so waiting looks deliberate; batch all NLI pairs in one forward pass; run the contradiction confirm calls **after** showing the verified answer (progressive render); cap `num_predict` at 400; cache answers by (question, as_of, corpus hash) in SQLite, so rehearsed demo questions come back instantly but are still real; stay on AC power with the Windows "Best performance" power mode.

---

## C. Final architecture

### C.1 Pipelines

```
INGESTION (offline, before demo; also triggered by upload)
PDF ──PyMuPDF──► pages ─► blocks/lines (bbox) ─► clause segmenter (regex: ^\d+(\.\d+)*[A-Z]?, (a), Annex, Schedule)
                                   │                     │
                                   │                     ├─► sentences (id, text, page, bbox[])     ──► SQLite
                                   │                     └─► heading_path, parent clause            ──► SQLite
                                   └─► find_tables() ─► rows "Header1: v | Header2: v" (header repeated, page-break stitched) ──► SQLite
chunks (clause, or ≤350 tokens with parent pointer) ─► bge-m3 (GPU once) ─► vectors.npy ; bm25s index ─► index/
amendment pass: regex triggers ─► LLM extract (JSON schema) ─► amendments(status=proposed) ─► UI confirm table ─► confirmed
(Stage 3) contradiction scan: kNN pairs ─► value filter ─► LLM confirm ─► contradictions

QUERY
question ─(Hindi? detect script)─► [bge-m3 dense ∥ BM25] ─RRF─► top-30 ─rerank─► top-8 chunks
   ─► amendment-aware expansion (add current version + status tags) ─► sentence-ID'd evidence (e1..eN)
   ─► LLM DRAFT (JSON: claims[{t, cite[], kind, calc?}], answerable, missing[])
   ─► VERIFIER per claim: cite∈evidence → numeric match → clause_status(as_of) → NLI batch → (borderline: LLM judge)
   ─► faithfulness = supported/draft_claims
   ─► calculations: Python recompute from SUPPORTED operands
   ─► contradiction check on cited/top evidence (pairs filtered, amendment-linked excluded, LLM confirm)
   ─► abstention decision + missing-evidence message
   ─► (Hindi) translate supported claims; numbers-preserved guard; quotes stay in English source
   ─► AnswerObject ─► Streamlit (chips → PyMuPDF page render + bbox rectangles)
```

### C.2 SQLite data model

- `documents(doc_id PK, title, filename, sha256, doc_type[master|circular|contract|kfs|policy|schedule|camera_capture|other], issuer, circular_no, issue_date, effective_date, level[int: same-level grouping], page_count, file_size_bytes, source[corpus|upload|camera], uploaded_at, ingested_at, ingest_status[queued|parsing|indexed|failed], ingest_error, n_clauses, n_tables, n_amendments_proposed, n_amendments_confirmed, n_alerts, active bool)`. `active=0` hides a document from retrieval without deleting it (K.3)
- `chats(chat_id PK, title, created_at, updated_at)`
- `messages(msg_id PK, chat_id FK, turn int, version int, role[user|assistant], text, input_mode[typed|camera|voice], image_path null, answer_json null, as_of, created_at)`. Editing a prompt adds a new `version` to the same `turn` (K.2)
- `shares(token PK [secrets.token_urlsafe(24)], chat_id, snapshot_json, include_crops bool, created_at, expires_at, revoked bool, view_count)` (K.4)
- `clauses(clause_id PK, doc_id FK, clause_ref ['7.2', '7.2A', '7.2(b)', 'Annex3'], heading_path, parent_clause_id, page_start, page_end, text, chain_root_key ['A:7.2'])`
- `sentences(sent_id PK, clause_id FK, doc_id, page, ord, text, bboxes_json [[x0,y0,x1,y1],...], is_table_row bool, values_json [normalised values])`
- `tables(table_id PK, doc_id, clause_id, page_start, page_end, header_json, n_rows)`; table rows live in `sentences` with `is_table_row=1`
- `chunks(chunk_id PK, clause_id, sent_ids_json, text, vec_row int)`
- `amendments(amend_id PK, source_doc_id, source_clause_id, target_doc_id, target_clause_ref, target_root_key, via_amend_id, action[substitute|insert|delete|withdraw_document], old_text, new_text, old_value, new_value, issue_date, effective_date, trigger_phrase, evidence_sent_id, confidence, status[proposed|confirmed|rejected])`
- `contradictions(contra_id PK, sent_a, sent_b, clause_a, clause_b, subject, attribute, value_a, value_b, kind[number|date|rule|eligibility], scope[intra|cross], source[query|scan], confirmed_by_llm bool, created_at)`
- `answers_cache(key PK [sha(q|as_of|corpus_hash)], answer_json, created_at)`
- `eval_results(run_id, qid, category, correct, citation_valid, faithfulness, abstained, expected_abstain, contradiction_hit, current_source_ok, latency_ms, stage_ms_json, model, tau_e, tau_c, created_at)`
- `feedback(fb_id PK, answer_key, question, rating[up|down|auto], reason[wrong_answer|wrong_citation|should_answer|should_refuse|missed_conflict|false_conflict|other], note, answer_json, reviewed bool, gold_id null, created_at)` (J.3). `rating=auto` rows are logged automatically for every abstention and blocked claim.

### C.3 JSON schemas (compact; short keys save output tokens)

**LLM claim draft**
```json
{"answerable": true,
 "claims": [
   {"t": "The prepayment penalty on floating-rate home loans for individual borrowers is nil.",
    "cite": ["e4"], "kind": "fact|calc_operand|calc_result|conflict_note",
    "q": "optional exact substring of a cited sentence",
    "calc": null}
 ],
 "missing": ["string: info the question needs that the evidence lacks"]}
```
`calc` (only for kind=calc_result): `{"formula": "emi|simple_interest|percent_of|service_credit", "operands": {"P": "e7", "r": "e8", "n": "e9"}}`. Operands are evidence IDs, and Python parses the values from those sentences and computes the result. The LLM's number is never shown unless it matches.

**Amendment extraction**
```json
{"amendments": [
  {"target_doc_ref": "Master Policy on Retail Loans | Circular SCB/RL/2025/14",
   "target_clause_ref": "7.2", "action": "substitute|insert|delete|withdraw_document",
   "old_value": "2%|null", "new_value": "1%|null", "new_text": "string|null",
   "effective_date": "YYYY-MM-DD|null", "effective_rule": "date|immediate|date_of_circular",
   "evidence": "e12", "confidence": 0.0}
]}
```

**Contradiction confirmation**
```json
{"same_subject": true, "subject": "penal charges on overdue instalments", "attribute": "rate",
 "value_a": "2% p.a. over contracted rate", "value_b": "24% p.a.",
 "conditions_a": "all retail loans", "conditions_b": "home loan (KFS)",
 "conflict": true, "kind": "number|date|rule|eligibility", "explanation": "one sentence"}
```

**Final answer object (to the UI)**
```json
{"question": "...", "lang": "en|hi", "as_of": "2026-11-23", "status": "answered|partial|abstained|conflicted",
 "faithfulness": {"supported": 7, "total": 9, "pct": 77.8},
 "claims": [{"text": "...", "text_hi": null, "verdict": "supported|unsupported|contradicted|conflicted",
             "reason": "value 3% not in cited text", "nli": {"entail": 0.91, "contradict": 0.02},
             "citations": [{"sent_id": "...", "doc_title": "...", "clause_ref": "7.2", "page": 3,
                            "quote": "verbatim sentence", "bboxes": [[0,0,0,0]], "status": "current|superseded|not_yet_effective",
                            "preview": "data:image/png;base64,... (cropped page region with the sentence highlighted; used by the hover tooltip)"}]}],
 "calculations": [{"formula": "EMI = P·r·(1+r)^n / ((1+r)^n − 1)", "inputs": {"P": 3000000, "r": 0.0079167, "n": 240},
                   "steps": ["r = 9.5%/12 = 0.0079167", "..."], "result": 27964.0, "operand_citations": ["..."]}],
 "contradictions": [{"subject": "...", "a": {"citation": {}}, "b": {"citation": {}}, "kind": "number", "scope": "cross", "note": "..."}],
 "amendment_chains": [{"root": "A:7.2", "events": [{"doc": "A", "ref": "7.2", "date": "2025-04-01", "text": "2%", "state": "superseded"}], "pending": []}],
 "abstention": {"abstained": false, "message": null, "searched": {"docs": 7, "terms": []}, "closest": []},
 "timings_ms": {"retrieve": 0, "rerank": 0, "draft": 0, "verify": 0, "contradiction": 0, "translate": 0}}
```

### C.4 Prompt strategy

| Call | Purpose | Inputs | Output | Key rules |
|---|---|---|---|---|
| DRAFT | Answer as atomic claims | question (English; Hindi questions translated first or passed as-is, since Qwen reads both), as_of, ≤8 evidence blocks: `[e4] (Doc C ¶3, p2, CURRENT) text`, superseded tagged | Draft schema | One fact per claim; cite only given IDs; never use outside knowledge; prefer CURRENT evidence; if the evidence lacks something, put it in `missing` and don't guess; for calculations, emit operand claims + a calc spec, no arithmetic |
| AMEND_EXTRACT | Structure an amendment | trigger sentence(s) ±2 sentences, source doc metadata, list of known doc titles/circular numbers | Amendment schema | Map the target to a known doc title; dates as ISO; null if not stated |
| CONTRA_CONFIRM | Confirm a conflict | two quotes + their heading paths + doc titles/dates | Contradiction schema | Different conditions or scope means no conflict; amendment language means no conflict |
| JUDGE (borderline) | Second check on entailment | claim, cited sentences | `{"supported": bool, "reason": str}` | Literal reading only |
| TRANSLATE_HI | Hindi output | verified English claims | `{"hi": [str]}` | Keep numbers, ₹ amounts and clause refs unchanged; the guard compares the extracted digits |
| QUERY_HI→EN (Stage 3) | Better BM25 for Hindi questions | Hindi question | `{"en": str}` | Dense retrieval already works cross-lingually; this helps BM25 |

### C.5 Model loading strategy
- **GPU:** Ollama LLM (resident). Reranker too, only in the 4B configuration.
- **CPU:** bge-m3 queries, NLI, (9B case) reranker.
- **Ingestion order:** embed the corpus on GPU with bge-m3 **before** starting Ollama, or run `ollama stop` first. Then free the CUDA memory.
- **Upload during the demo:** embed on CPU (a 5-page PDF ≈ 40 chunks ≈ 5–10 s [E]). The amendment LLM pass runs on the resident LLM.
- **Voice (Stage 3):** faster-whisper and Piper run on the CPU, loaded only the first time voice is used, never on the GPU.
- **Camera OCR (Stage 3):** RapidOCR (ONNX Runtime) runs on the CPU, loaded the first time the camera is used (~0.3 GB RAM [E]), never on the GPU.

---

## D. Repository structure

```
HackaSol2026/
  README.md                     # overview, pipeline diagram, model table, how to run offline, eval results
  pyproject.toml / requirements.txt
  app.py                        # Streamlit entry: Ask (chat + history sidebar), Library, Alerts, Eval tabs; ?share=<token> → read-only view
  dai/
    config.py                   # paths, model names, thresholds (τ_e, τ_c, τ_r), as-of default
    db.py                       # SQLite schema creation + small query helpers
    parse.py                    # PyMuPDF → pages, lines, bboxes; clause segmentation; heading paths
    tables.py                   # find_tables, header repetition, page-break stitching, row → sentence text
    normalise.py                # numbers, %, ₹/Rs/lakh/crore, durations, dates → typed values; match()
    index.py                    # chunking, bge-m3 embeddings (.npy), bm25s index build/load
    retrieve.py                 # hybrid search, RRF, rerank, amendment-aware expansion, evidence IDs
    llm.py                      # Ollama client: schema-constrained calls, think=false, retry/repair, timing
    draft.py                    # DRAFT prompt assembly + parse into claims
    verify.py                   # citation, numeric, supersession, NLI batch, judge band, verdicts, faithfulness
    nli.py                      # NLI model load + batched scoring
    amendments.py               # regex triggers, AMEND_EXTRACT, root-key resolution, clause_status(as_of), timeline
    contradictions.py           # pair generation/filters, CONTRA_CONFIRM, amendment exclusion, scan mode
    calc.py                     # EMI / interest / percent / service-credit formulas with step-by-step working
    abstain.py                  # gates + missing-evidence message
    hindi.py                    # script detection, translate, number-preservation guard
    feedback.py                 # feedback log, auto-logged failures, review queue → gold entries (J.3)
    voice.py                    # Stage 3: faster-whisper STT + Piper TTS, loaded on first use (J.2)
    chat_store.py               # chats/messages persistence, turn versions for edit and resend (K.2)
    library.py                  # document list and status, soft disable, re-ingest, index rebuild (K.3)
    share.py                    # frozen snapshots, tokens, expiry and revoke, self-contained HTML export (K.4)
    ocr.py                      # Stage 3: RapidOCR on camera photos → text + boxes; "check this clause" matching (K.1)
    render.py                   # full page → PNG with bbox rectangles; cropped, highlighted previews for hover tooltips (cached by sent_id)
    pipeline.py                 # ask(question, as_of) → AnswerObject; ingest(pdf) orchestration
    cli.py                      # python -m dai.cli ask "..." / ingest corpus/
  corpus/
    templates/*.html.j2, style.css   # source of the synthetic documents
    build_pdfs.py               # Playwright → corpus/pdf/*.pdf
    pdf/                        # generated PDFs (committed; small)
  scripts/
    fetch_real_docs.py          # downloads 1 real RBI circular (not committed)
    bakeoff_llm.py, bakeoff_parse.py
  eval/
    gold.jsonl                  # 33 questions
    run_eval.py                 # metrics → eval_results + CSV; threshold sweep mode
  data/                         # dai.sqlite, vectors.npy, bm25/ (gitignored)
```

---

## E. Time-boxed solo build plan (hours from now; T0 = start), revised

**Principle (revised): get a crude end-to-end version working first, then improve it.** By hour 8.5, a question typed in the browser returns a cited answer, however rough. Every later block improves an app that already works. A block that overruns then costs one feature, not the whole demo.

⚡ = could be parallelised if a teammate appears. ⛳ = checkpoint with a cut-line.

| Hours | Stage | Goal and tasks | Definition of done | Depends on |
|---|---|---|---|---|
| **0–1** | S1 | **Setup + LLM bake-off** (as in Q2). Also a 2-minute test: does `st.html` keep a `<style>` block and a data-URI `<img>`? (Hover previews depend on it, J.1) | Model chosen by the Q2 decision rule; VRAM and tok/s in `docs/bakeoff.md`; hover test result noted | — |
| **1–3** | S1 | **Corpus:** 7 HTML docs + `build_pdfs.py`, including the rule/eligibility contradiction (F 3.2 vs G) and calculation operands that aren't part of any planted conflict. ⚡ | 7 PDFs open correctly. `corpus/FACTS.md` lists every planted fact and every *intended* contradiction, and has been re-read for *unintended* ones | — |
| **3–3.5** | S1 | **Gold set v1** (33 questions) from FACTS.md. ⚡ | `gold.jsonl` validates | corpus |
| **3.5–5.5** | S1 | **Ingestion v1:** parse.py (clauses, sentences, bboxes, heading paths), tables.py (basic `find_tables` + repeated headers), db.py. The 1-hour parse bake-off happens inside this block | `cli ingest` fills the DB; Schedule I rows correct; 10 bboxes spot-checked on rendered pages | corpus |
| **5.5–6.5** | S1 | **Retrieval:** BM25 + dense + RRF, evidence IDs, parent context. No reranker | Recall@10 ≥ 85% on the answerable gold questions | ingestion |
| **6.5–8.5** | S1 | **First end-to-end version:** llm.py + draft.py (ID citations), a check that each cited ID exists, faithfulness on the draft, and a bare Streamlit page: question box → claims with citation chips → clicking a chip shows the rendered page | A question typed in the browser returns a cited answer with a faithfulness %. Ugly is fine | retrieval |
| ⛳ **CP1 @8.5** | | If the browser path doesn't work: fix it before adding anything else. If ingestion is the blocker, drop table stitching and Docling | | |
| 8.5–9 | — | Meal | | |
| **9–10.5** | S1 | **Full verifier:** normalise.py (with reference stripping + 25 unit tests), nli.py (base model), verify.py (all 4 checks, verdicts, reasons), abstain.py (gates + missing-evidence message). Wired into the existing page | 3 trap questions abstain with specific messages; a planted wrong-number claim is blocked and shows its reason | first end-to-end version |
| **10.5–12.5** | S1 | **Amendments (simplified actions):** regex triggers, AMEND_EXTRACT, chain resolution through `via_amend_id`, `clause_status(as_of)`, verifier check (d), amendment-aware expansion, as-of date picker + timeline in the UI | "Current prepayment penalty" → Nil, chain A→B→C; as-of 2025-10-15 → 2%; the future fee cap shows as pending | verifier |
| ⛳ **CP2 @12.5** | | **Amendment cut-line:** if LLM extraction is unreliable, fill the amendments table by hand through the confirm/edit table and tell the judges so. Resolution and the timeline still work | | |
| **12.5–14** | S1 | **Query-time contradictions:** numeric path + non-numeric path, CONTRA_CONFIRM, amendment exclusion, CONFLICTED downgrade, side-by-side card in the UI | All 5 planted contradictions are found by their gold questions; A 7.2 vs B is not flagged | amendments |
| ⛳ **CP3 @14** | | **Contradiction cut-line:** if the non-numeric path raises false alarms, ship the numeric path only and drop the eligibility conflict from the demo | | |
| 14–14.5 | — | Commit, run the eval once (CLI), list the failures | `eval_results` has rows | |
| **14.5–19.5** | — | **Sleep (5 h)** | | |
| 19.5–20 | — | Meal, review the failure list | | |
| **20–22.5** | S1/S2 | **Finish the UI:** blocked claims struck through with reasons, faithfulness badge, full-page highlight on click, **hover previews** (J.1). **Document Library tab** (K.3): multi-file upload → ingest → status, upload time, amendment confirm/edit table. **Chat persistence + edit and resend** (K.2). ⚡ | All 6 must-haves visible in the browser; hovering a citation shows the highlighted crop; the Library lists 7 docs with upload times; editing a past question creates version 2/2, and the ‹ › arrows switch back to 1/2 | everything above |
| ⛳ **CP4 @22.5** | | If the 6 must-haves aren't all visible: stop Stage 2/3 work until they are. Hover falls back to click (`st.popover`); highlighting falls back to "page image + quote below". Edit and resend falls back to "copy into the input box" | | |
| **22.5–24** | S2 | **Ingestion-time contradiction scan → Alerts tab** (moved up from S3); calc.py (EMI, penal interest, service credit, each with working) | The Alerts tab lists the planted conflicts without anyone asking; 3 calculation gold questions correct | contradictions |
| 24–24.5 | — | Meal | | |
| **24.5–26** | S2 | Eval tab + threshold sweep; **share snapshot + HTML export** (K.4); reranker test (keep it only if recall@5 rises by ≥5 points); answer cache + warm-up | Scoreboard renders; thresholds chosen; a share link opened in a private window shows the read-only chat; the exported HTML opens offline with crops | |
| ⛳ **CP5 @26** | | If behind: drop all of Stage 3. If ahead, do Stage 3 in this order: Hindi → camera "check this clause" (K.1) → feedback log (J.3) → one bounded re-retrieval → voice | | |
| **26–27** | S3 | Hindi (translate verified claims, number guard); then camera input (K.1) if time remains | 3 Hindi questions answered with English quotes; a photographed clause is OCR'd, shown for editing, and either matched to a corpus clause or answered | |
| **27–28** | S1 | **README** (pipeline diagram, model table, eval numbers, offline run steps) + final eval run | README renders on GitHub; numbers match the Eval tab | |
| **28–29.5** | — | **Demo prep:** 3 full rehearsals with Wi-Fi **off**, timed; record a backup screen video; warm the cache; set the power plan | A 5-minute run without touching code; backup MP4 saved locally | |
| 29.5–30 | — | Buffer / submission | Pushed and tagged | |

**What moved, compared with the first version of this plan:**
- The first end-to-end version moved to hours 6.5–8.5. Previously the UI only started at hour 20.
- Highlighting and hover previews sit in the S1/S2 UI block. Sentence bboxes already exist, so the crops are cheap.
- The ingestion-time contradiction scan moved from Stage 3 to Stage 2, because proactive alerts are part of the deliverable.
- The feedback log and review queue are new in Stage 2 (~30 min).
- Voice is new in Stage 3, after Hindi.
- The reranker stays in Stage 2 and is off by default.
- Amendment actions are simplified, which saves ~1–2 h in the 10.5–12.5 block.

---

## F. Demo script (5 minutes), revised

**Rule:** only **5 questions run live**. At 13–20 s each, 9 live questions would spend half the demo waiting. Everything else is shown from a panel that is **clearly labelled "pre-run, same pipeline, same corpus"**. If judges discover cached answers presented as live, that hurts credibility more than waiting does.

**0:00 Setup (before the judges arrive):** app open, cache warm, AC power on, "Best performance" mode. **Turn Wi-Fi off on camera** and show `ollama ps` and the airplane-mode icon: "Everything you see runs on this laptop."

| Time | Action / question | What it proves | Expected on screen |
|---|---|---|---|
| 0:20 | Documents tab: 7 PDFs; **Alerts tab** listing the conflicts found at ingestion with no question asked; amendment table A 7.2 ← B ¶2 ← C ¶3 | Multi-doc ingestion, proactive contradiction alerts, amendment extraction + human confirm | Alert cards; the chain table |
| 0:50 | **LIVE 1:** "What is the prepayment penalty on a floating-rate home loan today?" Then **hover over the citation** | Amendment chain, current version, exact citation | "Nil for individual borrowers", cite C ¶3 p.2, timeline 2% → 1% → Nil ✅; hovering shows the highlighted crop of the PDF line |
| 1:30 | **LIVE 2:** same question, as-of = 2025-10-15 | Effective-date resolution | "2%", cite A 7.2; B shown as not yet effective on that date |
| 1:55 | **LIVE 3:** "Are co-borrowers covered under the home loan protection insurance?" | Rule/eligibility contradiction, side by side | F 3.2 "co-borrowers … are covered" vs G "co-borrowers are not covered"; the answer states the conflict and doesn't pick a side |
| 2:35 | **LIVE 4:** "What is the foreclosure charge on gold loans?" | Zero-guessing abstention | "I don't have proof… Searched 7 documents… closest: A 7.2/7.3 cover home/retail loans, not gold loans" |
| 3:00 | **LIVE 5:** a question that reliably yields one blocked claim (choose it during rehearsal; e.g. "What's the grace period and cover amount for the protection policy?") | Faithfulness on the draft, blocking with a reason | "4/5 supported (80%)", 1 claim struck through with its reason |
| 3:35 | **Pre-run panel** (labelled): EMI with working and cited operands; penal charge 2% vs 24% conflict (calculated under both if reliable); grievance 30 vs 21 days (intra-document); future-dated processing-fee cap ⏳ | Breadth without waiting | Expandable cards, each with its citations and hover previews |
| 4:00 | **Edit and resend** LIVE 4's question to "What is the prepayment penalty on a **fixed-rate home** loan?" (counts as live question 6; skip it if the demo is over time) | Edit and resend (K.2); the same system answers once the proof exists | Version 2/2: "3%", cite A 7.3; ‹ › switches back to the abstention |
| 4:15 | (Only if Stage 3 is done) **Camera:** photograph a printed copy of KFS's "24% p.a." line | Camera input + "check this clause" (K.1) | Editable OCR text → "Matches KFS p.2; conflicts with Master Policy 8.1" card |
| 4:30 | **Share:** click Share → open the link in a private window; show the Library tab with upload times | Read-only shareable snapshot (K.4), document library (K.3) | Frozen read-only chat; library table |
| 4:45 | Eval tab scoreboard | Measured, not cherry-picked | Scoreboard + failures |

**Backup plan:** (1) If a live question hangs for more than 40 s, switch to its pre-run card and say so. (2) A backup MP4 of the full run is on the desktop. (3) If a judge uploads an unseen PDF: ingest it (≈10–30 s), show its parsed clauses and any proposed amendments, ask one question about it, and say upfront that amendment extraction on unfamiliar formats goes through a human-confirm step.

---

## G. README outline

1. What it does (6 must-haves, each with a screenshot)
2. **Verification pipeline diagram** (C.1 query part as a figure or ASCII art) plus the claim verdict definitions (Q5)
3. **Models table**

| Role | Model | Params / quant | Licence | Runs on |
|---|---|---|---|---|
| Generation, extraction, translation | Qwen3.5-9B-Instruct (or 4B) | Q4_K_M GGUF | Apache-2.0 | GPU (Ollama) |
| Embeddings | BAAI/bge-m3 | 568M fp32 | MIT | CPU (query) / GPU (ingest) |
| Reranker | BAAI/bge-reranker-v2-m3 | 568M | Apache-2.0 | CPU or GPU |
| Entailment verifier | MoritzLaurer/DeBERTa-v3-large-mnli-fever-anli-ling-wanli | 435M | MIT | CPU |
| PDF parsing / rendering | PyMuPDF | — | AGPL-3.0 | CPU |
| Runtime | Ollama | — | MIT | — |
| Speech-to-text (Stage 3) | faster-whisper `small` (multilingual) | 244M, int8 | MIT | CPU |
| Text-to-speech (Stage 3) | Piper + one en and one hi_IN voice | — | Check the licence: the maintained fork may be GPL, and voice licences vary | CPU |
*(re-check every licence on its model card before submitting)*

4. Amendment resolution: rules, the as-of date, the chain example
5. Contradiction vs supersession: definitions
6. Faithfulness score: definition (draft claims, before blocking)
7. Eval results table + how to rerun
8. Run offline: install steps, `ollama pull`, `python -m dai.cli ingest corpus/pdf`, `streamlit run app.py`
9. Limitations (born-digital PDFs only; amendment extraction needs confirmation on unseen formats; English-source verification)

---

## H. Risk register

| Risk | Likelihood | Impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| 9B + encoders exceed 8 GB VRAM / swap to shared memory | Med | High (latency ×5) | Encoders on CPU; 4B fallback | `nvidia-smi` shows >7.6 GB, or Ollama logs a partial offload |
| RAM exhaustion (16 GB) | Med | High (Windows paging, demo freeze) | One process; NLI-base; close browsers/IDE during the demo; Edge only | Task Manager memory >90% |
| Thermal throttling over long runs | Med | Med (+30–50% latency) | AC power, Best performance mode, laptop raised/cooling pad, warm-up but no long idle loops | tok/s falls >25% across a rehearsal |
| Battery / power-saver clocks | Low (if plugged in) | High | Check the power plan in the pre-demo checklist | Unplugged icon |
| Malformed JSON | Med | Med | Schema constraint, temp 0, one repair retry, graceful abstain | >5% invalid in the bake-off |
| Qwen3.5 thinking leaks / slow | Med | Med | `think:false`; 4B/Gemma fallback | Output contains reasoning text |
| Ollama 0.17.1 lacks the qwen3.5 tag | Med | Low | Upgrade Ollama / import GGUF | `pull` fails in hour 0 |
| Over-abstention | High | High (looks broken) | Borderline judge band, tuned τ, parent context | Over-abstention >10% on gold |
| Number normaliser misses a format | Med | Med (false blocks) | 25+ unit tests; the "reason" string makes it visible | Blocked claims citing "value not found" when it is visible |
| Table parse errors (page-break tables) | Med | Med | Bake-off; header stitching; Docling fallback | Schedule I cells wrong |
| Judge uploads an unseen PDF | Med | Med | Generic clause segmenter fallback (paragraph chunks), confirm UI, set expectations | — |
| Streamlit rerun reloads models | Med | Med | `st.cache_resource`; one load at startup | Clicks take >2 s |
| Playwright Chromium download fails later | Low | Low | Build PDFs in hour 1–3 while online; commit PDFs | — |
| Running out of time | High | High | First end-to-end version by hour 8.5; checkpoints CP1–CP5; Stage 3 is optional | Any checkpoint missed by >1 h |
| Hover tooltip: `st.html` strips the `<style>` block or data-URI images | Low–Med | Low | Fall back to `components.html` (iframe), then to `st.popover` on click | Fails the 2-minute test in hour 0 |
| Voice pushes RAM past 16 GB / Hindi transcription errors | Med | Med | Load on first use; whisper-small int8; editable transcript before submitting; voice is the first thing cut | RAM >90% after voice loads |
| Feedback loop loosens the verifier ("learns" to guess) | Low (human-gated) | High | No automatic threshold or model changes; only a reviewer turns feedback into gold entries | — |
| Non-numeric contradiction path raises false alarms | Med | Med | Cap of 3 pairs, LLM confirm compares conditions; CP3 cut-line | False conflicts on non-contradiction gold questions |
| Browser blocks the camera (opened by LAN IP over http, not localhost) | Med | Low | Demo on `localhost`; upload a photo as the fallback (`st.file_uploader` for images) | The camera widget shows a permission error |
| OCR misreads digits (2% read as 29%) | Med | Med | Editable OCR text before submitting; the low-confidence words are highlighted; the matched corpus clause is shown verbatim | Wrong match in rehearsal |
| A share link leaks confidential quotes | Med | High | Snapshot holds only that chat; secret token; expiry + revoke; warning in the dialog; public tunnel off by default | — |
| A shared snapshot goes stale after an amendment | Low | Med | The snapshot shows as-of date + corpus hash, with a "frozen on <date>" banner | — |
| Streamlit query-param routing for `?share=` | Low | Low | `st.query_params` read at the top of `app.py`; test in hour 24.5 | — |

---

## I. Open questions and assumptions

| Assumption | If wrong |
|---|---|
| Developer is comfortable in Python, little JS (the brief left a placeholder) | If strong in React/JS: FastAPI + React gives a nicer UI at +3 h. Only worth it if that person is a second teammate |
| The laptop display runs on the iGPU, so the dGPU is nearly free | If the dGPU drives the display (MUX on dGPU mode), lose ~0.5–1 GB VRAM → choose 4B |
| Qwen3.5-9B Q4_K_M is ~5.6 GB and Apache-2.0 | Check the HF card in hour 0; if bigger, use 4B |
| "Today" = system date, with an as-of override | If judges expect a fixed date, set the default in config |
| "Sentence" for faithfulness = one atomic draft claim | If judges count rendered sentences, it's identical by construction |
| Same-level documents without amendment language never supersede each other | If a judge argues that a later document wins, the UI already shows dates and the "later-dated" hint |
| Verification happens in English; Hindi is translated output only | Hindi-source PDFs would need mDeBERTa-xnli and Hindi BM25 tokenisation (out of scope) |
| Real RBI PDFs can be used in a demo without redistribution | If unsure, drop them; the synthetic corpus is enough for every must-have |
| Tokens/sec and latency figures are estimates | The hour-0 bake-off replaces them with measurements; update Q12 |

### Sources
- Qwen3.5 small models (sizes, 2026-03-02, context, BF16): [Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models), [HF Qwen3.5-0.8B card (Apache-2.0)](https://huggingface.co/Qwen/Qwen3.5-0.8B), [VentureBeat](https://venturebeat.com/technology/alibabas-small-open-source-qwen3-5-9b-beats-openais-gpt-oss-120b-and-can-run)
- 8 GB VRAM roundups (weak evidence, blogs): [localllm.in](https://localllm.in/blog/best-local-llms-8gb-vram-2025), [pinggy](https://pinggy.io/blog/small_llms_that_fit_in_8gb_memory/), [modelfit](https://modelfit.io/blog/best-ai-models-for-8gb-vram/), [vdf.ai](https://vdf.ai/blog/best-local-llm-by-vram/)
- Gemma 4 (2026-04-02, Apache-2.0, sizes): [Google blog](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/), [model card](https://ai.google.dev/gemma/docs/core/model%5Fcard%5F4), [9to5Google](https://9to5google.com/2026/04/02/google-gemma-4/)
- Ollama structured outputs: [docs](https://docs.ollama.com/capabilities/structured-outputs), [blog](https://ollama.com/blog/structured-outputs)
- PDF parsing: [Nutrient Docling alternatives](https://www.nutrient.io/blog/docling-alternatives.md), [LlamaIndex table parsing](https://www.llamaindex.ai/insights/best-table-parsing-ai), [arXiv 2603.18652](https://arxiv.org/abs/2603.18652), [Artifex PyMuPDF-Layout](https://artifex.com/blog/pymupdf-layout-performance-on-doclaynet-a-comparative-evaluation)
- Embeddings: [Hindi-BEIR arXiv 2408.09437](https://arxiv.org/pdf/2408.09437), [Qwen3 Embedding arXiv 2506.05176](https://arxiv.org/pdf/2506.05176), [Indic persona study arXiv 2601.10205](https://arxiv.org/pdf/2601.10205)
- NLI / grounding verifiers: [mDeBERTa 2mil7 card](https://huggingface.co/MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7), [Vectara faithfulness leaderboards arXiv 2505.04847](https://arxiv.org/abs/2505.04847), [LLM-AggreFact](https://llm-aggrefact.github.io/blog), [MiniCheck arXiv 2404.10774](https://arxiv.org/abs/2404.10774v2)
- RBI amendment drafting: [RBI NBFC Amendment Directions 2025](https://website.rbi.org.in/web/rbi/-/notifications/reserve-bank-of-india-non-banking-financial-companies-undertaking-of-financial-services-amendment-directions-2025), [RBI circular index](https://website.rbi.org.in/en/web/rbi/notifications/rbi-circulars?delta=100), [RBI withdrawal of circulars](https://website.rbi.org.in/documents/d/rbi/withdrawalofcirculars-1-)

**Not verified (check before relying on them):** exact Qwen3.5-9B GGUF size and its licence on the 9B card; whether Ollama 0.17.1 has the qwen3.5 tags and whether they load a vision projector; licences for bge-m3/bge-reranker/DeBERTa NLI/MiniCheck; all tok/s and latency figures; exact RBI phrase frequencies.


---

## J. Review of additional ideas: hover preview, voice, self-learning, E-means, and the original idea list

Every idea is judged by one question: does it help satisfy the PS better within 30 hours, or is it just technically interesting?

### J.1 Hover preview of cited passages: **adopted, Stage 2** (in the 20–22 UI block, ~1 h)

**Why:** a reader can check every claim against the PDF without leaving the answer. It directly strengthens the "exact citations" must-have and the highlighting bonus, and it is the most convincing visual proof that the system isn't guessing.

**How it works:**
- **Crops.** For each cited sentence, at answer time, PyMuPDF renders a crop of the page: `page.get_pixmap(clip=rect, dpi=150)`, where `rect` is the union of the sentence's bboxes, widened to page width and extended ~30 pt above and below for context. The sentence is drawn as a translucent yellow rectangle, either with `page.draw_rect(..., fill_opacity=0.3)` on an in-memory copy of the document or with PIL on the pixmap. Each crop is ~20–60 KB as PNG, stored base64 and cached by `sent_id`.
- **HTML.** The answer is rendered as HTML. Each claim is a `<span class="claim">`. Each citation chip is `<span class="cite">[C ¶3, p.2]<span class="tip"><img src="data:image/png;base64,..."><div>doc · clause · page<br>"verbatim quote"</div></span></span>`.
- **CSS only.** `.cite .tip{display:none;position:absolute;z-index:10;...}` and `.cite:hover .tip{display:block}`. Hovering a **claim line** shows its first citation's crop the same way (`.claim:hover > .tip-first`). No JavaScript is needed.
- **Streamlit.** Use `st.html(...)`. [M] Check in hour 0 that it keeps `<style>` and data-URI images; it doesn't run scripts, and we don't need it to. Fallback 1: `streamlit.components.v1.html` (an iframe with a fixed height). Fallback 2: a click-to-open `st.popover` per citation.
- **Click still works.** Clicking a chip still opens the full highlighted page, so the context is never lost.

**Cost:** ~1 h. **Risk:** low to medium, mostly Streamlit's HTML handling, which the hour-0 test settles.

### J.2 Voice input and output: **adopted, Stage 3, after Hindi**

**PS fit:** voice is not required and doesn't improve verification. Its value is demo appeal and accessibility, and it pairs naturally with the Hindi bonus. It comes after Hindi because Hindi is a listed PS bonus and voice is not.

**Hard rule: voice must stay local.** The PS's confidentiality argument applies to audio too. **Don't use the browser's Web Speech API.** Chrome's speech recognition sends audio to Google's servers [M], which breaks both the offline demo and the confidentiality story.

**Design:**
- **Input:** `st.audio_input` records in the browser and sends the audio to our own Streamlit server. **faster-whisper `small`** (multilingual, int8, CPU) transcribes it: ~0.5–1 GB RAM [E], ~2–5 s for a 5–10 s question [E]. The detected language routes the question through the existing Hindi path.
  - **The transcript appears in an editable text box before it is submitted.** Without this, a transcription error silently becomes a wrong question, which in a zero-guessing system is a guess.
- **Output:** **Piper TTS** (local, CPU, fast) with one English voice and one Hindi (hi_IN) voice. [M] Check in hour 0 that both voices exist and what their licences are.
  - Read aloud **only the SUPPORTED claims**, plus "N claims were blocked" and any abstention message. **Never read a blocked claim aloud.** Citations stay on screen.
- **Resources:** no GPU. +0.6–1.2 GB RAM. The 9B configuration is already at ~13.5 GB, so voice fits only with NLI-base and the reranker off, which are now the defaults. Load the voice models the first time voice is used, not at startup.
- **Cost:** 1–1.5 h. **Voice is the first thing cut if behind.**
- **Caveat:** whisper-small's Hindi accuracy is mediocre [M]; the editable transcript is the mitigation. `medium` is more accurate but needs ~2× the RAM and is slower, so don't use it on this laptop.

### J.3 "The system adapts based on its mistakes / relearns when it fails": **partly adopted, reframed**

**What's valid and gets built:**
1. **Runtime self-correction (Stage 3).** When a claim fails verification because a value is missing, the system re-queries **once** with the claim text plus the missing attribute, adds the new evidence and verifies again. Limiting it to one retry means it can't loop. This is "go back when it fails", at answer time.
2. **Failure capture (Stage 2, ~30 min).** Every answer gets 👍/👎 with a reason: wrong answer, wrong citation, should have answered, should have refused, missed a conflict, false conflict. Rows go into the `feedback` table along with the full AnswerObject. Every abstention and every blocked claim is also logged automatically (`rating=auto`).
3. **Human-reviewed improvement loop (Stage 2, reuses the eval tooling).** A "Review failures" view in the Eval tab. A reviewer turns a logged failure into a gold-set entry, and the threshold sweep reruns. Corrections that are pure data take effect immediately, for example a fixed amendment link in the confirm table or a new normaliser pattern.

So the system does improve from its failures, but a person decides what counts as a failure.

**What's rejected, and why:**
- **Retraining or fine-tuning the LLM, NLI model or embedder.** There is no labelled data and no spare VRAM (the LLM occupies the GPU), and even a LoRA run would take hours we don't have.
- **Changing thresholds automatically from live feedback, with no review.** The cheapest way for this system to "fail less" is to block less, which means guessing more. An unsupervised loop would drift directly against the PS's zero-guessing rule. A 👍 on a wrong answer would also teach it the wrong thing (feedback poisoning).

**How to say it to judges:** "It corrects itself at answer time, and over time it improves only through reviewed evidence. It never loosens its own rules."

### J.4 E-means: **still dropped**

Re-checked. Clustering has exactly one possible use in this pipeline: building an approximate (IVF) vector index. At our scale (a few thousand 1024-d vectors, ~10 MB), exact numpy search takes milliseconds, so there is no index to build and nothing to cluster.

The only other place grouping might help is pairing clauses for the contradiction scan, and kNN already does that directly. If clustering were ever needed, ordinary k-means on a few thousand points runs in well under a second with scikit-learn, so a faster k-means variant saves nothing.

I could not verify the claimed Meta FAIR origin or published results of "E-means", and the decision doesn't depend on it. Revisit only if the corpus grows past ~1M chunks.

### J.5 The original idea list, re-checked

| Original idea | Verdict now | Where it lives in this plan |
|---|---|---|
| Batch document processing | **Partly valid:** multi-file upload in the Documents tab (`accept_multiple_files=True`) and a simple loop that ingests them one by one. No batch infrastructure | E, 20–22 UI block |
| Pipeline optimisation | **Valid as latency tactics:** warm-up, resident model, answer cache, batched NLI, progressive rendering, ID citations. No general optimisation work beyond these | Q12 |
| Smart autoscaling | Dropped: one laptop, one user | — |
| GPU isolation (MIG) | Dropped: MIG exists only on datacenter GPUs (A100/H100 class); the RTX 4060 doesn't support it | — |
| Separate orchestration from inference | **Already true by construction:** Ollama runs as its own process and Python only orchestrates. Nothing extra to build | C.5 |
| Independent processing workers | **Valid as code structure:** parse / tables / normalise / index / amendments are separate modules with clear inputs and outputs. Not as separate services or queues | D |
| Structure-aware hierarchical chunking | Core; included | Q1, C.1 |
| Parent-child retrieval | Included | Q8(c), retrieve.py |
| Graph-augmented retrieval | Included **as the `amendments` table**: the "graph" is a table whose rows are the edges. No graph database | Q7, C.2 |
| Relationship-based retrieval | Included as amendment-aware expansion | Q7 |
| Multi-step agentic retrieval | Included as the **one** bounded re-retrieval (J.3, point 1). No open-ended agent | Stage 3 |
| Context-preserving retrieval | Included: heading paths, parent clause, repeated table headers | Q1, Q5 |
| WhatsApp integration | Still dropped. The deliverable is a web app, and WhatsApp would route confidential snippets and page images through Meta's servers, which contradicts the PS's own motivation. Hover previews and local voice cover the "nicer interaction" goal without that | — |
| E-means | Dropped (J.4) | — |

**Net result (J.5):** 10 of the 14 original ideas survive in some form, mostly as simpler versions of what was proposed: a table instead of a graph database, one retry instead of an agent, modules instead of workers. The 4 dropped ideas (autoscaling, MIG, WhatsApp, E-means) are the ones about scale or external channels, which the PS doesn't ask for.

---

## K. Four requested features: camera, edit and resend, document library, shareable chats

Each one is judged the same way as Section J: does it help the PS within 30 hours, and does it break any PS constraint (offline, confidential, verifiable)?

| Feature | PS fit | Conflicts with the PS? | Stage | Cost |
|---|---|---|---|---|
| K.1 Camera input | Indirect. The strongest framing is "check this printed clause against the corpus" | OCR of scanned PDFs was out of scope, so the camera is an **input** method, not a way to ingest scanned documents | S3 (after Hindi) | 1–1.5 h |
| K.2 Edit and resend | UX. It makes abstention less of a dead end: rephrase and retry | None | S2 | ~45 min |
| K.3 Document Library | Supports multi-document retrieval and amendment tracking (you can see what is loaded and what was confirmed) | None | S1/S2 | ~30 min (extends the Documents tab) |
| K.4 Shareable chat link | UX / collaboration | **Yes, if "public" means the open internet:** it sends confidential quotes through a third party and fails with Wi-Fi off. So it ships as a secret-token link served by the app itself, plus an HTML export | S2 | ~1 h |

### K.1 Camera input: adopted as "photograph a clause or question", Stage 3

**Design:**
- **Capture:** `st.camera_input` (built into Streamlit). The browser captures the frame and sends it to our **own local** Streamlit server, so no external service is involved. Also accept `st.file_uploader(type=["png","jpg"])`, which covers photos taken on a phone and a camera that is blocked.
  - **Constraint:** browsers allow camera access only in a secure context. `http://localhost` qualifies; `http://192.168.x.x` does not. Demo on localhost.
- **OCR: RapidOCR** (`rapidocr-onnxruntime`), CPU only, pip-installable on Windows, no Tesseract `.exe` [M]. It returns text with boxes and confidences.
  - Hindi: RapidOCR's default models cover Chinese and English. Devanagari needs a PaddleOCR multilingual model [M, check in hour 0]. If it isn't easy to get, the camera is **English only** and the README says so.
  - **Fallback:** Tesseract (UB-Mannheim Windows installer, has `hin` data). **Rejected:** using Qwen3.5's vision tower. It costs extra VRAM next to the LLM, and the plan already strips the vision projector (Q2).
- **The OCR text always lands in an editable box before it is submitted.** The reason is the same as for voice: an OCR error must not silently become the question. Words with confidence below 0.8 are underlined, so digits get a second look.
- **Two modes** (a toggle next to the camera):
  1. **Ask:** the OCR text becomes a normal question and runs the normal pipeline.
  2. **Check this clause:** this is the PS-aligned mode. The OCR'd text is treated as a *claimed clause*, and the system does three things:
     - (a) retrieves the closest corpus sentences and computes `rapidfuzz.token_set_ratio`; ≥90 means "found verbatim in Doc X p.Y";
     - (b) runs `clause_status(as_of)` on the match, so the answer can be "this clause was **superseded** by C ¶3 on 2026-07-01";
     - (c) runs the contradiction pair check between the photographed text and its top-5 neighbours.

     Output: a card that says "Matches KFS p.2 · Conflicts with Master Policy 8.1 (2% vs 24%) · Current", or "Not found in any loaded document: I don't have proof this clause applies."
- **The photo is not ingested as a document.** A photo has no reliable page or bbox mapping to a source PDF, so it can't satisfy "exact citations". It is stored only with its chat message (`messages.image_path`).
- **Resources:** ~0.3 GB RAM [E], loaded the first time the camera is used, ~1–2 s per photo on CPU [E].

### K.2 Editable prompts, resend and versions: adopted, Stage 2

**Behaviour (matching ChatGPT and Claude):**
- Each user message has ✏️ **Edit**. The message turns into a text area with **Save & resend**. Assistant answers have 🔁 **Regenerate**.
- Resending creates **version 2 of the same turn**. ‹ 1/2 › arrows under the turn switch between versions; both the question and its answer switch together.
- **The as-of date is part of the version.** Editing lets you change the question, the as-of date, or both. Re-asking a question with a different date is a natural way to show amendment chains.

**Why it's simpler here than in ChatGPT:** each question is answered from the documents alone, with no conversational memory feeding later answers. So editing turn 3 doesn't make turns 4–6 stale, and we keep them. ChatGPT has to discard the later turns because they depend on the earlier ones; we don't need a branch tree.
- If follow-up questions are ever added, editing a turn would mark the later turns "based on an older version", not delete them.

**Implementation:**
- `messages(turn, version)` in SQLite (C.2) and `st.session_state.view_version[turn]`.
- Streamlit: `st.chat_message` per turn, and an `st.button("✏️", key=f"edit_{turn}")` that sets `editing=turn`.
- The answer cache (Q12) makes switching back to an old version instant.
- A new version writes a new row and never overwrites the old one, so old versions stay as an audit trail.
- **Sidebar:** a chat history list (title = first question, truncated) with "New chat". This comes almost for free once messages are persisted, and the sharing feature needs it anyway.

### K.3 Document Library: adopted, Stage 1/2 (replaces the plain Documents tab)

One tab, one table, one row per document:

| Column | Source |
|---|---|
| Title / filename | `documents` |
| Type (master, circular, contract, KFS, policy, schedule) | Set at ingest; editable |
| Source (corpus / upload) | `documents.source` |
| **Uploaded at** (local time, e.g. "23 Nov 2026, 14:05") + **Ingested at** | `uploaded_at`, `ingested_at` |
| Pages · size · clauses · tables | counts |
| Status: queued / parsing / indexed / failed (with the error) | `ingest_status` |
| Amendments: proposed / confirmed, plus "this doc amends → …" and "amended by ← …" | `amendments` |
| Alerts involving this doc | `contradictions` |
| Actions: 👁 view (opens page 1 in the PDF viewer), ✅ confirm amendments, ⏸ disable / ▶ enable, ⟳ re-ingest | — |

- Sort by upload time, newest first. Filter by type. A search box filters by title.
- **Disable, not delete.** Hard delete would leave stale vector rows and broken amendment links. `active=0` filters the document out of retrieval, the Alerts tab and chain resolution. The resolver ignores amendments from inactive documents, so disabling Circular C turns the answer back into the 1% version. That makes a neat demo of the chain logic.
- The full index rebuild takes seconds at this corpus size (~7 docs), so re-ingest is simply "delete that document's rows + ingest again".
- **Upload flow (multi-file):** drop files → each row appears as "queued", then moves to "parsing" and then "indexed" (`st.status` / a progress bar), and the amendment confirm table opens for any new triggers.

### K.4 Shareable chat link: adopted with a changed definition, Stage 2

**The conflict:** a link anyone on the internet can open needs the chat hosted or tunnelled outside the laptop. That means confidential quotes and page crops pass through a third party, which is exactly what the PS says these organisations can't do, and it stops working with Wi-Fi off during the demo. So the default is a **self-hosted, secret-token, read-only snapshot**. A real public URL is a documented opt-in.

**Design:**
1. **Share button** on a chat → a dialog:
   - choose "whole chat" or "this answer only"; include page crops on/off; expiry 1 / 7 / 30 days;
   - a warning: "Anyone with this link can read the quoted passages and page crops in this chat."
2. **Frozen snapshot.** Store the AnswerObjects exactly as they were shown, plus the as-of date, corpus hash and model name, in `shares.snapshot_json`. Store the token, made with `secrets.token_urlsafe(24)`, unguessable.
   - The snapshot is **not re-run**. A shared answer is a record of what the system said, with what proof, on which date.
   - A banner reads: "Frozen on 23 Nov 2026 · as of 23 Nov 2026 · documents may have changed since."
3. **Read-only view.** `app.py` checks `st.query_params.get("share")` first. If present, it renders only that snapshot: claims, verdicts, faithfulness, citations with crops, contradiction cards and timelines. There is no sidebar, no upload, no other chats, and no input box.
   - Expired or revoked tokens show "This link is no longer available."
   - A "Shared links" list lets you revoke a link and see its view count.
4. **Who can open it:**
   - anyone who can reach the app: the same laptop, the same LAN at `http://<laptop-ip>:8501/?share=…`, or an organisation's internal server in a real deployment;
   - in the demo: open it in a private window on the same laptop.
5. **HTML export:** one self-contained `.html` file with inline CSS and base64 crops. It works offline, can be emailed, and needs no server. This is the most practical way to share inside a bank.
6. **Opt-in public internet link** (documented, not in the demo): `cloudflared tunnel --url http://localhost:8501`.
   - It is off by default, and the README warns that it sends the shared content through Cloudflare.
   - There is no authentication: the token only protects the snapshot, not the main app. So only expose the app while it is in share-only mode, `streamlit run app.py -- --share-only`, which disables every route except `?share=`.

**Rejected:** hosting snapshots on any cloud paste or bin service, which sends confidential data out with no control; and user accounts or login, which are out of scope.

### K.5 What these four features cost and what pays for them

They add about 3.25–3.75 hours in total: K.1 1–1.5 h, K.2 0.75 h, K.3 0.5 h, K.4 1 h.

The time comes from:
- **Voice** moves to the very end of Stage 3. It is the most likely thing never to be built.
- **The feedback log** moves from Stage 2 to Stage 3.
- **README** is ~30 min shorter, now 1 h. It still fits.
- **The final buffer** drops from 60 to 30 minutes.
- **Camera** sits behind Hindi in Stage 3. Hindi is a listed PS bonus; the camera is not.

If you hit CP5 late, the realistic outcome is: K.2, K.3 and K.4 are shipped, and K.1 and voice are not. That is still a complete PS submission.

---

## L. Production backend plan (Gemini + FastAPI): current

### L.1 Stack
| Layer | Choice | Why |
|---|---|---|
| API | FastAPI (async) + Pydantic v2; SSE for streamed answers | Separate frontend later; OpenAPI contract |
| LLM | Gemini via `google-genai`. Main: `gemini-3.8-flash`; fallbacks: `gemini-3.6-flash` → `gemini-3.5-flash-lite` (check the IDs in AI Studio) | Team decision; JSON schema output |
| Embeddings | `gemini-embedding-2`, 768 dims, multilingual | Hindi and English |
| Verifier | Deterministic checks (citation ID, numbers, supersession) + a Gemini strict-judge call that replaces NLI | The deterministic checks are now the main guard |
| DB | PostgreSQL 17 + pgvector; SQLAlchemy 2 async (asyncpg) | One store for data and vectors |
| Keyword search | Postgres full-text (`tsvector`, `simple` config so tokens like `7.2A` survive) | Works across several instances |
| Files | Storage interface: local disk in dev, GCS in prod | Cloud Run has no persistent disk |
| Ingestion jobs | FastAPI BackgroundTasks + a `jobs` table (status polling) | Simple; swap to a queue later |
| PDF | PyMuPDF (AGPL: the repo must stay public) | Parse, bboxes, tables, render |
| Auth | `X-API-Key` admin key on every route except `GET /shares/{token}` and `/health` | Minimal production safety |
| Deploy | Docker → Cloud Run; managed Postgres (Cloud SQL / Neon) | — |
| Dev | `docker compose` (pgvector image) + `uv` | — |

### L.2 Backend layout
```
backend/
  pyproject.toml, Dockerfile, docker-compose.yml, .env.example
  app/
    main.py            # FastAPI app, routers, lifespan, CORS, error handlers
    config.py          # pydantic-settings
    db.py              # async engine/session, init
    models.py          # ORM tables (documents, clauses, sentences, chunks, amendments, contradictions, chats, messages, shares, jobs, answer_cache)
    schemas.py         # API + LLM JSON schemas
    security.py        # API-key dependency
    storage.py         # local / GCS file storage
    llm/gemini.py      # generate_json, embed; retries, fallback models, timing
    ingest/parse.py    # PyMuPDF → clauses, sentences, bboxes, tables
    ingest/pipeline.py # store, embed, amendment pass, job status
    core/normalise.py  # typed values, reference stripping
    core/retrieve.py   # hybrid search + RRF + amendment-aware expansion
    core/amendments.py # trigger regex, extraction, clause_status(as_of)
    core/verify.py     # per-claim verdicts, faithfulness
    core/contradictions.py, core/calc.py, core/abstain.py, core/answer.py (orchestration)
    api/{documents,chats,amendments,alerts,shares,health}.py
  tests/
```

### L.3 Build order (backend), with progress tracked in `docs/PROGRESS.md`
1. Scaffold: config, DB, models, health, auth, docker compose
2. `normalise` + unit tests
3. Gemini client (JSON + embeddings + retries)
4. Ingestion: parse → DB → embeddings; documents API (upload, library, page render with highlights)
5. Retrieval (pgvector + FTS + RRF)
6. Draft + verifier + abstention → `POST /chats/{id}/messages` (SSE)
7. Amendments (extract, confirm API, resolution)
8. Contradictions (query-time + scan → `/alerts`)
9. Calculations, Hindi
10. Chats: edit/resend versions; shares (snapshot, token, HTML export)
11. Demo corpus + gold set + eval endpoint/script
12. Dockerfile + Cloud Run deploy notes + README
