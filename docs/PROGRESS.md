# Build Progress (backend)

Plan: `docs/RESEARCH_AND_PLAN.md`, Section L (current). Backend docs: `backend/README.md`.

## Status by step (L.3)

| # | Step | Status | Where |
|---|---|---|---|
| 1 | Scaffold: config, DB, models, auth, health, compose | ✅ | `app/main.py`, `config.py`, `db.py`, `models.py`, `security.py`, `docker-compose.yml` |
| 2 | Normaliser + unit tests | ✅ | `app/core/normalise.py` (22 tests) |
| 3 | Gemini client (JSON schema, embeddings, image read, retries, fallback, swap point) | ✅ code, ⏳ **not yet run live** | `app/llm/gemini.py` |
| 4 | Ingestion + Library API + page/crop rendering | ✅ | `app/ingest/*`, `app/api/documents.py`, `app/core/render.py` |
| 5 | Hybrid retrieval (pgvector + FTS + RRF), evidence IDs, amendment-aware expansion | ✅ | `app/core/retrieve.py` |
| 6 | Draft → verify → contradictions → abstention → faithfulness; SSE ask | ✅ | `app/core/answer.py`, `verify.py`, `app/api/chats.py` |
| 7 | Amendments: triggers, extraction (verbatim check), chain linking, as-of resolution, confirm/edit API, timeline | ✅ | `app/core/amendments.py`, `app/api/amendments.py` |
| 8 | Contradictions: query-time + ingest scan, numeric + rule/eligibility paths, `/alerts` | ✅ | `app/core/contradictions.py`, `app/api/alerts.py` |
| 9 | Calculations (EMI, interest, percent, sum) + Hindi (query translation, number-guarded answers) | ✅ | `app/core/calc.py`, `answer.py` |
| 10 | Chats with versions (edit/resend/regenerate); shares (snapshot, revoke, expiry, HTML export) | ✅ | `app/api/chats.py`, `app/api/shares.py` |
| 10b | Camera: photo → editable text; "check this clause" | ✅ | `app/api/camera.py` |
| 11 | Demo corpus (7 PDFs) + facts sheet + 36-question gold set + eval script | ✅ built, ⏳ **eval not yet run (needs key)** | `scripts/build_corpus.py`, `corpus/FACTS.md`, `eval/gold.jsonl`, `scripts/run_eval.py` |
| 12 | Dockerfile, deploy notes, README | ✅ image builds (`zeroguess-api`, 2.06 GB; slimming is optional) | `Dockerfile`, `README.md` |

## Verified
- `uv run pytest -q`: **27 passed**.
  - Normaliser: 22.
  - Parser: 2.
  - Library API: 2.
  - **Full pipeline e2e on the fake LLM: 1.** It covers:
    - the A→B→C chain resolved at 3 as-of dates;
    - edit and resend creating version 2;
    - a wrong number blocked, with faithfulness computed on the draft;
    - gold-loan abstention with a specific message;
    - EMI computed in Python (₹27,965);
    - the penal-charge contradiction in `/alerts`;
    - a Hindi answer with English quotes;
    - camera transcribe and clause check;
    - a share snapshot, its HTML export and revoke;
    - disabling circular C reverting the answer to 1%.
- The real server was smoke-tested on the dev DB: health, docs, multi-file upload, library, chat creation. The DB was reset afterwards.
- All 7 corpus PDFs parse with the expected clause numbers, types, circular numbers and dates.

## Remaining (needs `GEMINI_API_KEY` in `backend/.env`)
1. Check the model IDs (`GEMINI_MODEL`, fallbacks, embed model) against the key. A model that isn't available returns 404, and the client falls back to the next one automatically.
2. `uv run python -m scripts.run_eval --key <API_KEY> --ingest`, then tune `min_dense_score` and the prompts from the scoreboard.
3. Frontend (later phase).

## Decisions and deviations log
- **2026-11-23:** Gemini only (team decision). NLI and reranker replaced by deterministic checks + a batched Gemini judge. Risk noted for mid-evaluation (PS asks for open-source models; free-tier data use).
- **2026-11-23:** Corpus PDFs are built with PyMuPDF Story instead of Playwright.
- **2026-11-23:** Tables continued across a page break reuse the previous header within the same clause.
- **2026-11-23:** Without embeddings a document is `indexed_no_vectors`; keyword search still works.
- **2026-11-23:** An amendment's `new_text` must appear (fuzzy ≥90) in the source clause, otherwise the verbatim clause text is stored.
- **2026-11-23:** Amendments auto-confirm at confidence ≥0.8 with a resolved target document; otherwise `proposed` until a person confirms them.
- **2026-11-23:** Faithfulness counts `supported` + `conflicted` claims as backed by a quote, over all draft claims.
- **2026-11-23:** Edit and resend keeps later turns, because each answer depends only on the documents.
- **2026-11-23:** HTML share export is at `/public/shares/{token}/html` (avoids a route clash).
- **Known gaps:** no Alembic yet; Cloud Run needs `--no-cpu-throttling`; one Story page-break row in Schedule I is kept as plain text; single API key, not user accounts.
- **Git:** nothing committed yet.
