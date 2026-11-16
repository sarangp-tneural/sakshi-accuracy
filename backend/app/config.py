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
    # once recording, no new data for this long ends it (kept as partial)
    rtsp_stall_s: int = 45
    # attempting to connect: keep trying for this long, a new try every `retry` s, each try given up on after `try` s without video
    rtsp_attempt_window_s: int = 300
    rtsp_attempt_retry_s: int = 10
    rtsp_attempt_try_s: int = 25
    rtsp_min_footage_bytes: int = 16 * 1024  # a file this big holds real video (not just the header), so the camera is "connected"
    rtsp_io_timeout_s: int = 10  # ffmpeg's own socket timeout, so a dead camera fails fast instead of hanging
    # every recording and preview goes through a local mediamtx relay (it handles camera logins ffmpeg cannot)
    rtsp_relay: bool = True
    rtsp_relay_api: str = "http://127.0.0.1:9997"
    rtsp_relay_host: str = "127.0.0.1"
    rtsp_relay_port: int = 8554
    cors_origins: list[str] = ["http://localhost:5173"]
    celery_eager: bool = False  # tests run tasks inline


settings = Settings()
