import logging
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/.env (or the repo-root .env), wherever uvicorn/pytest is started from; a CWD-relative ".env" would be
# silently skipped from the other folder. When both exist, backend/.env wins.
BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = (BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env")
DEV_JWT_SECRET = "dev-only-change-me-to-a-long-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_fallback_models: str = "gemini-3.6-flash,gemini-3.5-flash-lite"
    gemini_embed_model: str = "gemini-embedding-2"
    embed_dim: int = 768
    # a timed-out call is retried on the SAME model this many times before the fallback model answers: measured on the
    # 127-question set, every fallback draft was a timeout, and a fallback model drafts differently (2 of 4 answers
    # changed). A retry usually lands in ~7 s, about what the fallback took (4-12 s); 0 = fall back at once.
    llm_timeout_retries: int = 1
    llm_timeout_s: float = 30.0  # per attempt (drafts take ~6-15 s)
    # Gemini "thinking" per call: MINIMAL | LOW | MEDIUM | HIGH, empty = the model's default. Less thinking is faster;
    # measure answer quality (scripts.run_eval) before lowering it. The draft has its own knob, the other calls
    # (judge, contradiction confirm, translation, amendment extraction, intent) share LLM_THINKING.
    # Unset, Gemini 3 thinks at HIGH. The draft gets MEDIUM (it composes the answer); the other calls are narrow
    # yes/no or rewrite tasks and get LOW. All configured models accept both levels (checked 2026-11-23).
    llm_thinking: str = "LOW"
    llm_thinking_draft: str = "MEDIUM"

    database_url: str = "postgresql+asyncpg://zeroguess:zeroguess@localhost:5433/zeroguess"
    api_key: str = "change-me"  # service/script access (X-API-Key, or the /auth/session cookie); acts as admin
    llm_provider: str = "gemini"  # gemini | fake (dev only: deterministic stand-in from tests/fake_llm.py, no key needed)
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # auth (JWT access token in Authorization header + rotating refresh token in an httpOnly cookie)
    jwt_secret: str = DEV_JWT_SECRET
    access_ttl_min: int = 30
    refresh_ttl_days: int = 14
    google_client_id: str = ""  # OAuth 2.0 Web client ID from Google Cloud console
    admin_emails: str = ""  # comma-separated; these users get role=admin on first sign-in
    allowed_email_domains: str = ""  # comma-separated; empty = any verified Google account
    allow_password_login: bool = True
    seed_admin_email: str = ""
    seed_admin_password: str = ""
    cookie_secure: bool = False  # True in production (HTTPS)
    cookie_samesite: str = "lax"  # "none" if frontend and API are on different sites (requires secure)

    storage_backend: str = "local"  # local | s3 | gcs
    storage_dir: str = "./data/files"
    gcs_bucket: str = ""
    # S3 or any S3-compatible store (AWS S3, Cloudflare R2, Railway buckets, MinIO). Credentials come from the usual
    # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY variables.
    s3_bucket: str = ""
    s3_region: str = ""
    s3_endpoint_url: str = ""  # empty = AWS; set for R2/MinIO/Railway buckets
    s3_prefix: str = ""  # optional folder inside the bucket

    # tamper-proof reports: base64 of a 32-byte Ed25519 seed. Empty = derived from JWT_SECRET (stable while it is).
    report_signing_key: str = ""
    # the address people open, for links printed inside offline report copies (e.g. https://zeroguess.example)
    public_origin: str = ""

    # production: the built web app (frontend/dist), served by this API from the same origin. Empty = API only.
    static_dir: str = ""

    # verification / retrieval thresholds (tuned on the eval set)
    retrieve_k: int = 20
    rrf_k: int = 60
    fts_weight: float = 0.3  # keyword ranks' weight in the fusion (meaning-based search = 1.0)
    fts_max_df: float = 0.10  # keyword search ignores words found in more than this share of the searched chunks
    min_dense_score: float = 0.35  # abstention gate: best cosine below this -> no proof

    max_upload_mb: int = 40
    # per-user quota on the PDFs in a signed-in user's chats (admins and the service key are exempt). Counted over the
    # distinct documents linked to their chats, demo documents excluded: removing a PDF from every chat frees its slot.
    max_user_documents: int = 5
    max_user_upload_mb: int = 30
    max_pdf_pages: int = 100  # every upload, admins included: parsing and embedding cost grow with pages
    # daily usage per signed-in non-admin user (UTC day). Model calls are what cost money: questions (ask, edit, run
    # again), photos read by the camera, and PDFs added (new files: a re-link of one they already have is free).
    max_daily_questions: int = 50
    max_daily_camera: int = 20
    max_daily_uploads: int = 20
    amend_autoconfirm: float = 0.8  # amendments below this confidence (or unresolved target) wait for a human
    max_evidence: int = 40  # sentences sent to the drafter
    answer_cache: bool = True

    @field_validator("google_client_id", mode="before")
    @classmethod
    def _clean_client_id(cls, v: object) -> object:
        # a pasted id with a stray space or quotes never matches the token's `aud` claim
        return v.strip().strip("\"'").strip() if isinstance(v, str) else v

    @field_validator("database_url", mode="after")
    @classmethod
    def _asyncpg_url(cls, v: str) -> str:
        # Railway/Render/Heroku hand out postgres:// or postgresql:// URLs; SQLAlchemy async needs the asyncpg
        # driver, and asyncpg takes ssl=require instead of libpq's sslmode=require
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                v = "postgresql+asyncpg://" + v[len(prefix):]
        return v.replace("sslmode=", "ssl=")

    @field_validator("storage_dir", mode="after")
    @classmethod
    def _anchor_storage_dir(cls, v: str) -> str:
        # "./data/files" relative to backend/, not to wherever the server was started: otherwise a restart from
        # another folder can't find the PDFs uploaded before it (pages, crops and re-ingest fail)
        p = Path(v)
        return str(p if p.is_absolute() else (BACKEND_DIR / p).resolve())

    @model_validator(mode="after")
    def _jwt_secret_present(self) -> "Settings":
        # .env.example ships `JWT_SECRET=` blank; an empty HMAC key makes every sign-in a 500 ("HMAC key must not be empty")
        if not self.jwt_secret.strip():
            if self.cookie_secure:
                raise ValueError("JWT_SECRET is empty. Set a long random value in backend/.env before running in production.")
            logging.getLogger(__name__).warning("JWT_SECRET is empty in backend/.env: using the dev-only secret")
            self.jwt_secret = DEV_JWT_SECRET
        return self

    @property
    def fallback_models(self) -> list[str]:
        return [m.strip() for m in self.gemini_fallback_models.split(",") if m.strip()]

    @property
    def admin_list(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    @property
    def domain_list(self) -> set[str]:
        return {d.strip().lower().lstrip("@") for d in self.allowed_email_domains.split(",") if d.strip()}

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
