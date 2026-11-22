import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import alerts, amendments, camera, chats, documents, shares
from app.config import get_settings
from app.db import engine, init_db
from app.security import require_api_key

logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","log":"%(name)s","msg":"%(message)s"}')


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield
    await engine.dispose()


app = FastAPI(title="Zero-Guessing Document AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=get_settings().cors_list, allow_methods=["*"], allow_headers=["*"], allow_credentials=False
)

auth = [Depends(require_api_key)]
for r in (documents.router, chats.router, amendments.router, alerts.router, shares.router, camera.router):
    app.include_router(r, prefix="/api", dependencies=auth)
app.include_router(shares.public)  # token-protected, no API key


@app.get("/health", tags=["ops"])
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
