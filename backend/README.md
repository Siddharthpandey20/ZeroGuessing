# Zero-Guessing Document AI: backend

FastAPI service that answers questions across multiple PDFs **only with verifiable evidence**. It also resolves amendment chains as of a date, flags contradictions with both quotes, abstains with a specific "I don't have proof" message, and reports a faithfulness score.

## Verification pipeline

```
question ─► (Hindi? translate query) ─► hybrid retrieval: pgvector cosine ∥ Postgres full-text ─► RRF
        ─► sentence-level evidence e1..eN, each tagged CURRENT / SUPERSEDED / NOT YET EFFECTIVE / DELETED
           (amendment-aware expansion adds the version in force and the amending text)
        ─► Gemini DRAFT: atomic claims that cite evidence IDs (quotes are verbatim by construction), JSON schema
        ─► VERIFY each claim:
             (a) cited IDs exist in the evidence shown
             (b) every number/date/amount in the claim is in the cited quote (₹/lakh/crore, %, p.a., days, dates;
                 clause and circular numbers stripped first); a different value of the same kind = contradicted
             (d) cited clause is in force on the as-of date (unless the claim is explicitly historical)
             (c) one batched strict-judge call for entailment of the survivors
             calculations: operands must match their quotes; Python does the arithmetic and shows the working
        ─► contradiction check on the evidence (bounded pairs, amendment-linked pairs excluded, LLM confirmation)
             supported claims touching a confirmed conflict → "conflicted", both quotes shown side by side
        ─► abstention gate + specific missing-evidence message (what was searched, what was closest)
        ─► faithfulness = claims backed by a quote / ALL draft claims (computed before blocking)
        ─► (Hindi) translate verified claims; translations that change any number are dropped
```

Verdicts:
- **supported:** passes (a), (b), (d) and the judge.
- **unsupported:** missing citation or value, or the judge isn't convinced.
- **contradicted:** a value conflicts, the clause is superseded, or the judge finds a contradiction.
- **conflicted:** supported, but the documents disagree on this point.

Only supported and conflicted claims are shown as the answer. Blocked claims are returned with their reasons, so the UI can strike them through.

**Amendments vs contradictions.** An amendment ("in partial modification of… shall be substituted… with effect from…") is detected by regex triggers and extracted by Gemini. Its `new_text` must really appear in the source clause, otherwise the verbatim clause is used. It is linked to the **root clause**, even through chains (C amends B ¶2, which amended A 7.2), and is resolved by effective date. Future-dated changes show as pending. Amendment-linked clauses are never reported as contradictions.

## Models (Gemini API)
| Role | Model (env var) | Notes |
|---|---|---|
| Drafting, amendment extraction, contradiction confirmation, verification judge, translation, camera OCR | `GEMINI_MODEL` (default `gemini-3.8-flash`), fallbacks `GEMINI_FALLBACK_MODELS` | JSON-schema constrained, temperature 0 |
| Embeddings | `GEMINI_EMBED_MODEL` (default `gemini-embedding-2`), `EMBED_DIM=768` | Multilingual; vectors L2-normalised |

All model access goes through `app/llm/gemini.py` (`get_llm()` / `set_llm()`), so another provider, such as a local model, can be swapped in.
> ⚠️ The PS asks for open-source models without paid APIs. Gemini is free-tier but closed, and **free-tier inputs may be used by Google to improve its products**. Use the paid tier for real confidential data. Raise this at mid-evaluation.

## Run locally
```bash
cd backend
cp .env.example .env                 # put GEMINI_API_KEY here (.env is gitignored; never put the key in .env.example)
docker compose up -d db              # Postgres 17 + pgvector on localhost:5433
uv sync
uv run uvicorn app.main:app --reload # API docs: http://localhost:8000/docs
uv run python -m scripts.build_corpus           # 7 demo PDFs -> corpus/pdf
uv run python -m scripts.run_eval --key change-me --ingest   # upload corpus + score the gold set
```
Tests (fake LLM, needs the compose DB): `docker compose exec db psql -U zeroguess -c "CREATE DATABASE zeroguess_test"` once, then `uv run pytest -q`.

### After restarting the PC
From the repo root: `powershell -ExecutionPolicy Bypass -File .\start.ps1`. It starts Docker Desktop and waits for it, starts the database, then opens the API and the web app in two windows (`-NoBackend -NoFrontend` for only the database).
- Users, chats and documents live in the Docker volume `backend_pgdata` and uploaded PDFs in `backend/data/files`, so they survive restarts. **Never** run `docker compose down -v` or delete that volume: that is what erases them.
- The database container restarts by itself whenever Docker Desktop starts. If the app says it can't reach the database, Docker Desktop isn't running yet, or another container holds port 5433 (`docker ps`, then `docker stop <name>`).
- A PDF that was still being read when the PC went down is finished automatically when the API starts.
- Tests use the separate `zeroguess_test` database and refuse to run against any other, so they can't wipe your data.

## Auth
| Who | How | Role |
|---|---|---|
| Browser user | **Sign in with Google**: the frontend gets a Google ID token from Google Identity Services and calls `POST /api/auth/google {"credential": "<id token>"}`. The backend checks the signature, audience, issuer and verified email | `admin` if listed in `ADMIN_EMAILS`, otherwise `viewer` |
| Browser user (fallback) | `POST /api/auth/login {"email","password"}`; accounts are created by an admin (`POST /api/users`) or seeded with `SEED_ADMIN_*` | as assigned |
| Script / eval / server | header `X-API-Key: <API_KEY>` | admin |

- Login returns `{access_token, expires_in, user}` and sets two **HttpOnly** cookies:
  - `zg_access`: the same access JWT (30 min), so `<img src="/api/...png">` works;
  - `zg_refresh`: 14 days, path `/api/auth`, rotated on every use; reusing an old one revokes the session.
- Send `Authorization: Bearer <access_token>`, or rely on the cookie with `credentials: "include"`. On a `401`, call `POST /api/auth/refresh` and retry. `POST /api/auth/logout` ends the session. `GET /api/auth/me` returns the profile. `GET /api/auth/config` (public) tells the login page whether Google and password login are on, and gives the Google client ID.
- **viewer:** ask, chat, edit and resend, share, camera, read the library, alerts and amendments.
- **admin:** also upload, edit, disable and re-ingest documents, confirm or edit amendments, run and dismiss scans, and manage users (`GET/POST/PATCH /api/users`).
- Chats are private to their owner. Share links stay public by token.
- Google setup (free): Google Cloud console → APIs & Services → Credentials → OAuth client ID → "Web application". Add the frontend URL(s) to **Authorized JavaScript origins** (e.g. `http://localhost:5173` and the production URL), then put the client ID in `GOOGLE_CLIENT_ID`.

## API (all `/api/*` need a signed-in user or `X-API-Key`)
| Area | Endpoints |
|---|---|
| Library | `POST /api/documents` (multi-file upload), `GET /api/documents` (upload time, status, counts), `GET/PATCH /api/documents/{id}` (edit, `active=false` to disable), `POST /api/documents/{id}/reingest`, `GET /api/documents/{id}/file`, `GET /api/documents/{id}/pages/{n}.png?highlight=sid,sid`, `GET /api/sentences/{id}/preview.png`, `GET /api/jobs/{id}` |
| Chat | `POST /api/chats`, `GET /api/chats`, `GET /api/chats/{id}` (turns with all versions), `DELETE /api/chats/{id}`, `POST /api/chats/{id}/messages` (SSE by default; `?stream=false` for JSON), `PUT /api/chats/{id}/turns/{turn}` (edit and resend → new version), `POST /api/chats/{id}/turns/{turn}/regenerate` |
| Amendments | `GET /api/amendments?status=proposed`, `POST /api/amendments` (manual), `PATCH /api/amendments/{id}` (confirm/reject/edit), `GET /api/documents/{id}/clauses/{ref}/timeline?as_of=` |
| Alerts | `GET /api/alerts` (side-by-side quotes), `POST /api/alerts/scan`, `DELETE /api/alerts/{id}` |
| Camera | `POST /api/camera/transcribe` (image → editable text), `POST /api/camera/check-clause` |
| Sharing | `POST /api/chats/{id}/shares`, `GET /api/chats/{id}/shares`, `DELETE /api/shares/{token}`; public (no key): `GET /public/shares/{token}` (JSON snapshot), `GET /public/shares/{token}/html` (self-contained export) |
| Ops | `GET /health` |

SSE events: `stage` (retrieving → drafting → verifying → checking_contradictions → translating_answer), then `answer` (full AnswerObject + stored message) or `error`.

## Deploy (Cloud Run)
1. Managed Postgres with pgvector (Cloud SQL for PostgreSQL 15+, or Neon/Supabase). Set `DATABASE_URL=postgresql+asyncpg://…`.
2. Create a GCS bucket and set `STORAGE_BACKEND=gcs`, `GCS_BUCKET=…`. Cloud Run has no persistent disk.
3. Put `GEMINI_API_KEY` and `API_KEY` in Secret Manager and expose them as env vars. Set `CORS_ORIGINS` to the frontend URL.
4. `gcloud run deploy zeroguess-api --source backend --region asia-south1 --set-env-vars … --set-secrets …`
5. **Turn on "CPU always allocated"** (`--no-cpu-throttling`). Ingestion runs as a background task after the upload response, and SSE answers stream for 5–20 s.
6. Tables are created on startup (`create_all`). Add Alembic before running more than one environment.

## Limits (honest)
- Born-digital PDFs only. Scanned PDFs need OCR, which is out of scope. The camera feature reads a *question or clause photo*; it does not ingest documents.
- Amendment extraction on unfamiliar formats can need human confirmation (`status=proposed`; threshold `AMEND_AUTOCONFIRM`).
- Substitution works at whole-clause or sub-clause level. Value replacement inside a clause needs the confirm/edit table.
- Single API key, not user accounts. Share links are capability tokens with expiry and revoke.
