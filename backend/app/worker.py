import logging
import shutil
from pathlib import Path

from celery import Celery

from . import control, media, rtsp
from .config import settings
from .db import SessionLocal
from .models import Video, now
from .storage import video_dir

log = logging.getLogger(__name__)
celery = Celery("sakshi", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.task_always_eager = settings.celery_eager


def _size(path: Path) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None


def _finish_media(db, v: Video, src: Path) -> None:
    """Probe + make playback copy for v. Sets status ready or failed."""
    try:
        info = media.probe(src)
        v.duration_s, v.fps = info["duration_s"], info["fps"]
        v.width, v.height, v.vcodec = info.get("width"), info.get("height"), info.get("vcodec")
        playback = video_dir(v.id) / "playback.mp4"
        media.make_playback(src, playback, info)
        v.playback_path = str(playback)
        v.status, v.status_reason = "ready", v.status_reason
    except Exception as e:  # noqa: BLE001
        v.status, v.status_reason = "failed", f"Could not prepare video: {str(e)[:300]}"


@celery.task
def process_upload(video_id: int) -> None:
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v:
            return
        _finish_media(db, v, Path(v.file_path))
        db.commit()


@celery.task
def record_rtsp(video_id: int) -> None:
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v:
            return
        url = rtsp.decrypt_url(v.rtsp_url_enc)
        out = Path(v.file_path)
        v.started_at = now()  # the moment ffmpeg starts, not when the job was queued
        db.commit()
        try:
            res = rtsp.run_recording(url, v.rtsp_minutes, out, should_stop=lambda: control.stop_requested(video_id))
        except Exception as e:  # noqa: BLE001
            res = {"status": "failed", "reason": rtsp.scrub(f"Recorder error: {e}", url)}
        v.ended_at = now()  # recording is over (turning it into a playable copy comes after)
        v.file_size = _size(out)
        if res["status"] == "failed":
            v.status, v.status_reason = "failed", res["reason"]
        else:
            _finish_media(db, v, out)
            if v.status == "ready":
                v.status = res["status"] if res["status"] == "partial" else "ready"
                v.status_reason = res["reason"]
        db.commit()
        control.clear_stop(video_id)


def enqueue(task, video_id: int) -> None:
    task.delay(video_id)
