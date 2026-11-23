# Production image: the web app and the API in one service (Railway, Render, or any Docker host).
# Build from the repo root:  docker build -t zeroguess .
# backend/Dockerfile stays for the API alone (docker compose --profile full).

# ---- 1. web app -> static files
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- 2. API, serving the web app from the same origin
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1
# Tesseract OCR for scanned PDFs (English + Hindi): about 45 MB
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin     && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv
# the user first, and files copied as that user: a later `chown -R` would duplicate every file in a new layer
RUN useradd -m appuser && mkdir -p /app/data/files && chown -R appuser /app
WORKDIR /app
USER appuser

COPY --chown=appuser backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --extra s3 --no-install-project

COPY --chown=appuser backend/app ./app
COPY --chown=appuser backend/scripts ./scripts
COPY --chown=appuser backend/corpus ./corpus
COPY --chown=appuser --from=web /web/dist ./static

# /app/data: mount a persistent volume here when STORAGE_BACKEND=local (Railway volume / Render disk)
ENV PATH="/app/.venv/bin:$PATH" PORT=8000 STATIC_DIR=/app/static STORAGE_DIR=/app/data/files \
    COOKIE_SECURE=true COOKIE_SAMESITE=lax
EXPOSE 8000
# one worker on purpose: PDF ingestion runs in-process in the background (interrupted ones resume on start)
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
