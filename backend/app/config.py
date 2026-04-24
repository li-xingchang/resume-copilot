from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database
    database_url: str  # postgresql+asyncpg://...

    # OpenAI
    openai_api_key: str
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"

    # AWS / Storage
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    s3_bucket: str = "resume-copilot-pdfs"

    # Auth (Clerk)
    clerk_secret_key: str = ""
    clerk_publishable_key: str = ""

    # App
    app_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    cors_origins: list[str] = ["http://localhost:3000"]

    # Rate limits (enforced in extension background.ts; mirrored here for audit)
    max_prefills_per_hour: int = 20
    min_field_delay_ms: int = 8000
    max_field_delay_ms: int = 22000

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
