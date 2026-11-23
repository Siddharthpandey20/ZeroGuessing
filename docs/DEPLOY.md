# Deploying to production (Railway or Render)

## Architecture

```
browser ──HTTPS──► one web service (repo-root Dockerfile)
                     ├─ FastAPI: /api, /auth, /public, /health
                     └─ the built web app (frontend/dist) on every other path
                           │                         │
                 managed Postgres 17 + pgvector   file storage for uploaded PDFs
                 (users, chats, clauses, vectors)  S3 bucket (recommended) or a mounted volume
```

- **One service, one origin.** The API serves the web app, so the auth cookies are first-party, page images authenticate, answers stream (SSE) with no proxy in between, and there is no CORS to configure.
- **Keep it at one replica.** PDF reading runs inside the API process. A document that was mid-ingest during a redeploy is picked up again automatically on start.
- **Storage:** use an **S3 bucket** (AWS S3, or any S3-compatible store such as Cloudflare R2 or Railway buckets), not an EC2 machine. A bucket is permanent, needs no server to patch, and costs cents. A Railway volume or Render disk also works (`STORAGE_BACKEND=local`), but it ties the service to one machine.
- The database schema is created on start, along with the additive migrations.

## Railway

1. **New project → Deploy from GitHub repo.** `railway.json` makes Railway build the root `Dockerfile` and health-check `/health`.
2. **Add a database:** deploy the **pgvector** Postgres template, or the image `pgvector/pgvector:pg17` with a volume on `/var/lib/postgresql/data`. Then, in the web service, set `DATABASE_URL=${{Postgres.DATABASE_URL}}`. A `postgres://` URL is converted to the right driver automatically.
3. **Set the variables** in the web service (see the table below).
4. **Settings → Networking → Generate domain.** Add that `https://…` URL to the Google OAuth client's **Authorized JavaScript origins**.

## Render

`render.yaml` is a Blueprint: **New → Blueprint →** pick the repo. It creates the web service and the Postgres database, and generates `JWT_SECRET` and `API_KEY`. Fill in the variables marked `sync: false` when prompted. The app enables pgvector on Render Postgres itself.

## Variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | from the Postgres service |
| `GEMINI_API_KEY` | your key (use the paid tier for real, confidential documents) |
| `JWT_SECRET` | a long random string: `python -c "import secrets; print(secrets.token_urlsafe(48))"`. The app refuses to start without one |
| `REPORT_SIGNING_KEY`, `PUBLIC_ORIGIN` | signs shared reports (base64 of 32 random bytes; keep it forever, or old reports stop verifying) and the address printed in offline copies |
| `API_KEY` | a long random string (used by scripts and eval) |
| `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS` | Google sign-in, and who becomes admin |
| `ALLOW_PASSWORD_LOGIN`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | optional email/password admin |
| `STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | PDF storage. For R2 or MinIO, also set `S3_ENDPOINT_URL`. `S3_PREFIX` is optional |
| or `STORAGE_BACKEND=local` | with a volume mounted at `/app/data/files` |

The image already sets `COOKIE_SECURE=true`, `STATIC_DIR` and `PORT` (Railway and Render override `PORT` themselves).

**AWS S3 setup:**
1. Create a private bucket.
2. Create an IAM user with only `s3:GetObject` and `s3:PutObject` on `arn:aws:s3:::<bucket>/*`.
3. Put that user's keys into the variables above.

## Try the production image locally
```bash
docker build -t zeroguess .
docker run --rm -p 8080:8000 --env-file .env --network zeroguess_default \
  -e DATABASE_URL=postgres://zeroguess:zeroguess@db:5432/zeroguess -e JWT_SECRET=some-long-random-string \
  -e COOKIE_SECURE=false -v zeroguess_files:/app/data/files zeroguess
# http://localhost:8080
```
