# ZeroGuess: frontend

Landing page and workspace for the zero-guessing document assistant.

**Stack:** React 19, TypeScript, Vite 6, React Router 7, TanStack Query 5, Floating UI (hover previews) and Lenis (landing-page smooth scroll). Styles are CSS Modules on one token file (`src/styles/tokens.css`). There is no UI kit and no animation library. Each route is its own chunk, so the landing page never downloads the workspace.

## Design

The design is built from three references:
- **wembi:** the paper surface, inset media panels, tight oversized grotesk headings, and the lime marker.
- **airforceecho:** the misty slate haze with a hex lattice and dust (`src/components/Haze.tsx`, one WebGL shader), and the decoding instrument readout.
- **santalarch:** the hairline grid that divides the workspace.

**One rule runs everything: lime means proven.**
- A claim is highlighted only after it passes verification.
- Conflicts are amber.
- Blocked claims are struck through with the reason they were blocked.

**Fonts:** Onest for all text, Tektur for the wordmark and the verification readout, Noto Sans Devanagari for Hindi. All fonts are self-hosted, so pages render with no network calls to font services.

**Landing-page specimens:** the crops in `src/assets/specimens/` are rendered from the demo corpus PDFs, so they show real passages, not invented ones.

## Screens

| Route | What it does |
|---|---|
| `/` | Landing page: a live specimen of the verification pipeline, the four proofs, how the checks work |
| `/sign-in` | Google sign-in (when `GOOGLE_CLIENT_ID` is set on the API) or email and password |
| `/app`, `/app/c/:id` | Ask. Answers stream stage by stage. Claims carry citation chips: hover shows the highlighted page crop, click opens the full page in the evidence panel. Also: side-by-side conflicts, the amendment timeline, worked calculations, abstention with what is missing, the faithfulness meter, edit and resend with versions, run again, sharing |
| `/app/library` | Upload (admin), ingest status, the amendment confirm table, per-document clauses, use or stop using a document |
| `/app/alerts` | Conflicts found across the library, both pages side by side |
| `/s/:token` | Read-only frozen share, no sign-in needed |

## Run locally

```bash
# API (from backend/): the fake model needs no key; seed an admin to sign in with
LLM_PROVIDER=fake SEED_ADMIN_EMAIL=admin@zeroguess.dev SEED_ADMIN_PASSWORD=demo-pass-123 \
  uv run uvicorn app.main:app --port 8000

# Frontend
cd frontend
npm install
npm run dev        # http://localhost:5173; /api, /auth and /public are proxied to :8000
```

Set `VITE_API_ORIGIN` to point the dev proxy at another API. The browser only ever talks to one origin, so the API's HttpOnly cookies authenticate both `fetch` calls and `<img>` page renders.

## Deploy (free tier)

**Frontend: Cloudflare Pages.**
- Build command `npm run build`, output directory `dist`, root directory `frontend`.
- Set `API_ORIGIN` (for example `https://<space>.hf.space`) in the project's environment variables.
- `functions/[[path]].js` proxies `/api/*`, `/auth/*` and `/public/*` to that origin and streams the response body, so answers stay live.
- `public/_routes.json` keeps every other request on the static CDN. `public/_headers` makes `/assets/*` immutable.
- Unknown paths fall back to `index.html`.

**API:** any container host. On the API, set `COOKIE_SECURE=true`. CORS isn't needed, because the browser sees one origin.
