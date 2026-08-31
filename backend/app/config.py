"""Application settings, loaded from environment variables / .env files.

Reads, in order (later files override earlier ones): backend/.env, then the
repo-root keys.env — so a single keys.env at the repo root is enough for
local development without duplicating secrets into backend/.env.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../keys.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    anthropic_api_key: str | None = None
    cors_origins: str = "http://localhost:5173"

    # Base URL of the client tablet web app — used to build the QR payload
    # a newly created Station encodes ("{APP_URL}/client?pair=...").
    app_url: str = "http://localhost:5173"

    # How long a pairing PIN stays valid after a station is created.
    station_pin_ttl_seconds: int = 300

    # Where scanned ID/license photos are saved (app/checkout/documents.py).
    # Relative paths resolve against the process's working directory
    # (normally backend/, when running `uvicorn app.main:app` from there).
    uploads_dir: str = "uploads"

    environment: str = "development"

    @property
    def sqlalchemy_database_url(self) -> str:
        """Normalize to the psycopg (v3) driver, which ships prebuilt wheels
        for current Python versions (psycopg2 does not, as of this writing).

        Neon hands out `postgres://` or `postgresql://`; SQLAlchemy needs an
        explicit `+psycopg` to pick the v3 driver instead of defaulting to
        psycopg2.
        """
        url = self.database_url
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
