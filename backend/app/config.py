from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_fallback_models: str = "gemini-3.6-flash,gemini-3.5-flash-lite"
    gemini_embed_model: str = "gemini-embedding-2"
    embed_dim: int = 768
    llm_timeout_s: float = 60.0

    database_url: str = "postgresql+asyncpg://zeroguess:zeroguess@localhost:5433/zeroguess"
    api_key: str = "change-me"  # service/script access (X-API-Key, or the /auth/session cookie); acts as admin
    llm_provider: str = "gemini"  # gemini | fake (dev only: deterministic stand-in from tests/fake_llm.py, no key needed)
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # auth (JWT access token in Authorization header + rotating refresh token in an httpOnly cookie)
    jwt_secret: str = "dev-only-change-me-to-a-long-random-string"
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

    storage_backend: str = "local"  # local | gcs
    storage_dir: str = "./data/files"
    gcs_bucket: str = ""

    # verification / retrieval thresholds (tuned on the eval set)
    retrieve_k: int = 20
    rrf_k: int = 60
    min_dense_score: float = 0.35  # abstention gate: best cosine below this -> no proof

    max_upload_mb: int = 40
    amend_autoconfirm: float = 0.8  # amendments below this confidence (or unresolved target) wait for a human
    max_evidence: int = 40  # sentences sent to the drafter
    answer_cache: bool = True

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
