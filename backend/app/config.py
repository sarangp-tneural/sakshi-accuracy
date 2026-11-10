from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://sakshi:sakshi@localhost:5442/sakshi"
    redis_url: str = "redis://localhost:6390/0"
    secret_key: str = "dev-secret-change-me-please-0123456789"
    jwt_expire_hours: int = 24 * 7
    data_dir: Path = ROOT / "data"
    max_upload_bytes: int = 4 * 1024**3
    max_rtsp_minutes: int = 120
    min_free_disk_bytes: int = 2 * 1024**3
    # approx. bytes needed per recorded minute, used by the disk guard
    rtsp_bytes_per_minute: int = 60 * 1024**2
    cors_origins: list[str] = ["http://localhost:5173"]
    celery_eager: bool = False  # tests run tasks inline


settings = Settings()
