"""Small Redis helpers shared by the API and the worker: the stop flag, and a heartbeat that says a recording is really being recorded."""
import json
import re

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
    _r().set(_key(video_id), "1", ex=TTL_S)


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


# --- heartbeat: the recorder refreshes this every second while it records (and while it turns the file into a video) ---
HEARTBEAT_TTL_S = 20
FINISHING_TTL_S = 30 * 60  # turning a long recording into a playable copy can take a while


def _hb_key(video_id: int) -> str:
    return f"sv:rec:{video_id}"


def heartbeat(video_id: int, ttl: int = HEARTBEAT_TTL_S) -> None:
    try:
        _r().set(_hb_key(video_id), "1", ex=ttl)
    except redis.RedisError:
        pass  # a Redis hiccup must never interrupt a recording


def clear_heartbeat(video_id: int) -> None:
    try:
        _r().delete(_hb_key(video_id))
    except redis.RedisError:
        pass


def heartbeats(video_ids: list[int]) -> set[int]:
    """Which of these videos have a live recorder. Raises redis.RedisError if Redis cannot be asked."""
    ids = list(video_ids)
    if not ids:
        return set()
    flags = _r().mget([_hb_key(i) for i in ids])
    return {i for i, f in zip(ids, flags) if f}


# --- "find still moments": a flag while the analysis of a video runs (deleting it is how Cancel works) ---
STILLS_TTL_S = 3600
STILLS_FAILED_TTL_S = 600


def _stills_key(video_id: int) -> str:
    return f"sv:stills:{video_id}"


def _stills_failed_key(video_id: int) -> str:
    return f"sv:stills:failed:{video_id}"


def stills_start(video_id: int) -> None:
    _r().set(_stills_key(video_id), "1", ex=STILLS_TTL_S)
    _r().delete(_stills_failed_key(video_id))


def stills_running(video_id: int) -> bool:
    try:
        return bool(_r().exists(_stills_key(video_id)))
    except redis.RedisError:
        return True  # cannot tell: do not cancel a running analysis because Redis hiccuped


def stills_clear(video_id: int) -> None:
    """Finished or cancelled: not running any more."""
    try:
        _r().delete(_stills_key(video_id))
    except redis.RedisError:
        pass


def stills_fail(video_id: int) -> None:
    try:
        _r().delete(_stills_key(video_id))
        _r().set(_stills_failed_key(video_id), "1", ex=STILLS_FAILED_TTL_S)
    except redis.RedisError:
        pass


def stills_failed(video_id: int) -> bool:
    try:
        return bool(_r().exists(_stills_failed_key(video_id)))
    except redis.RedisError:
        return False


_ARGS = re.compile(r"\(?\s*(\d+)\s*,?\s*\)?")
RECORDING_TASKS = ("app.worker.record_rtsp", "app.worker.finalize_recording")


def video_id_from_args(args) -> int | None:
    """The video id out of a task's arguments, whether Celery gives them as a list or as the text "(118,)"."""
    if isinstance(args, (list, tuple)) and args and isinstance(args[0], int):
        return args[0]
    if isinstance(args, str):
        m = _ARGS.fullmatch(args.strip())
        return int(m.group(1)) if m else None
    return None


def queued_video_ids(queue: str = "celery") -> set[int]:
    """Recording tasks still waiting in the broker queue (not yet picked up by any worker)."""
    out: set[int] = set()
    for raw in _r().lrange(queue, 0, -1):
        try:
            h = json.loads(raw).get("headers", {})
        except (ValueError, AttributeError):
            continue
        if h.get("task") in RECORDING_TASKS and (vid := video_id_from_args(h.get("argsrepr"))) is not None:
            out.add(vid)
    return out
