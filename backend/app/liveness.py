"""Is anything actually recording this video? A row says "recording", but if its worker was restarted or crashed, nothing is."""
from concurrent.futures import ThreadPoolExecutor
from typing import Iterable

import redis

from . import control


INSPECT_TIMEOUT_S = 1.0


def _inspected(celery_app) -> set[int]:
    """Recording tasks that workers report as running or reserved, asked in parallel (each question waits for slow workers).
    Silent if no worker answers: that alone is not evidence that a recording died."""
    found: set[int] = set()
    try:
        insp = celery_app.control.inspect(timeout=INSPECT_TIMEOUT_S)
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies = list(pool.map(lambda fn: fn() or {}, (insp.active, insp.reserved)))
        for reply in replies:
            for tasks in reply.values():
                for t in tasks:
                    if t.get("name") in control.RECORDING_TASKS and (vid := control.video_id_from_args(t.get("args"))) is not None:
                        found.add(vid)
    except Exception:  # noqa: BLE001
        pass
    return found


def live_among(video_ids: Iterable[int], celery_app) -> set[int] | None:
    """Those of `video_ids` that something is recording / about to record. None when we could not tell (Redis down),
    so callers never declare a recording dead on a guess."""
    ids = set(video_ids)
    if not ids:
        return set()
    try:
        live = control.heartbeats(sorted(ids)) | control.queued_video_ids()
    except redis.RedisError:
        return None
    if ids - live:  # something is not accounted for: ask the workers too (covers workers that predate the heartbeat)
        live |= _inspected(celery_app)
    return live & ids
