import asyncio
import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import alerts, amendments, auth as auth_api, camera, chats, documents, profile, shares
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
for r in (documents.router, chats.router, amendments.router, alerts.router, shares.router, camera.router, profile.router):
    app.include_router(r, prefix="/api", dependencies=auth)
app.include_router(shares.public)  # token-protected, no API key
app.include_router(auth_router)  # admin-key browser session (early frontend build)
app.include_router(auth_api.router)  # /api/auth: Google sign-in, password login, refresh, logout, me, config
app.include_router(auth_api.users)  # /api/users: admin user management


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",  # camera capture + voice input
}


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    return response


@app.get("/health", tags=["ops"])
async def health():
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}


# ---------------------------------------------------------------- production: the web app from the same origin
# One service serves the API and the built frontend, so auth cookies are first-party, <img> page renders
# authenticate, server-sent events stream without a proxy, and there is no CORS.
_static = Path(get_settings().static_dir) if get_settings().static_dir else None
if _static and (_static / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=_static / "assets"), name="assets")  # hashed names: cached forever
    _API_PREFIXES = ("api/", "auth/", "public/", "health", "docs", "redoc", "openapi.json")

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith(_API_PREFIXES):
            raise HTTPException(404, "not found")
        f = (_static / path).resolve()
        if path and f.is_file() and _static.resolve() in f.parents:
            return FileResponse(f)  # favicon, posters, robots.txt...
        return FileResponse(_static / "index.html", headers={"Cache-Control": "no-cache"})  # client-side routes
