"""Tiny cross-process flag so the API can ask the Celery worker to stop a recording."""
import redis

from .config import settings

_client: redis.Redis | None = None
TTL_S = 3600


def _r() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, socket_timeout=2)
    return _client


def _key(video_id: int) -> str:
    return f"sv:stop:{video_id}"


def request_stop(video_id: int) -> None:
    _r().setex(_key(video_id), TTL_S, "1")


def stop_requested(video_id: int) -> bool:
    try:
        return bool(_r().exists(_key(video_id)))
    except redis.RedisError:
        return False  # never kill a recording because Redis hiccuped


def clear_stop(video_id: int) -> None:
    try:
        _r().delete(_key(video_id))
    except redis.RedisError:
        pass
