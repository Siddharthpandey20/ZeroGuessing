import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import alerts, amendments, auth as auth_api, camera, chats, documents, shares
from app.config import get_settings
from app.db import SessionLocal, engine, init_db
from app.ingest.pipeline import resume_interrupted
from app.security import auth_router, require_api_key

logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","log":"%(name)s","msg":"%(message)s"}')


@asynccontextmanager
async def lifespan(_: FastAPI):
    if get_settings().llm_provider == "fake":  # dev only: UI work without a model key
        from app.llm.gemini import set_llm
        from tests.fake_llm import FakeLLM

        set_llm(FakeLLM())
        logging.getLogger(__name__).warning("LLM_PROVIDER=fake: answers come from the deterministic test stand-in")
    await init_db()
    async with SessionLocal() as session:
        await auth_api.seed_admin(session)
    resume = asyncio.create_task(resume_interrupted())  # PDFs that were mid-ingest when the server/PC went down
    yield
    resume.cancel()
    await engine.dispose()


app = FastAPI(title="Zero-Guessing Document AI", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=get_settings().cors_list, allow_methods=["*"], allow_headers=["*"], allow_credentials=True  # cookies; origins are an explicit list
)

auth = [Depends(require_api_key)]
for r in (documents.router, chats.router, amendments.router, alerts.router, shares.router, camera.router):
    app.include_router(r, prefix="/api", dependencies=auth)
app.include_router(shares.public)  # token-protected, no API key
app.include_router(auth_router)  # admin-key browser session (early frontend build)
app.include_router(auth_api.router)  # /api/auth: Google sign-in, password login, refresh, logout, me, config
app.include_router(auth_api.users)  # /api/users: admin user management


@app.get("/health", tags=["ops"])
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
