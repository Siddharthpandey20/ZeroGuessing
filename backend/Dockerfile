FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_NO_CACHE=1
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.9.18 /uv /usr/local/bin/uv
RUN useradd -m appuser && mkdir -p /app/data/files && chown -R appuser /app
WORKDIR /app
USER appuser

COPY --chown=appuser pyproject.toml uv.lock* ./
RUN uv sync --no-dev --extra gcs --extra s3 --no-install-project

COPY --chown=appuser app ./app
COPY --chown=appuser scripts ./scripts
COPY --chown=appuser corpus ./corpus
COPY --chown=appuser eval ./eval
ENV PATH="/app/.venv/bin:$PATH" PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
