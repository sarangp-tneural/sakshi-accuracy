import logging
import threading
from datetime import timedelta
from pathlib import Path

from celery import Celery
from celery.signals import worker_ready
from sqlalchemy import select

from . import control, liveness, media, rtsp, stills
from .config import settings
from .db import SessionLocal
from .models import Video, now
from .storage import video_dir, video_path

log = logging.getLogger(__name__)
celery = Celery("sakshi", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.task_always_eager = settings.celery_eager


def _size(path: Path) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None


COPY_NOTE = "The conversion was too slow, so a quick copy was saved instead (frame stepping may be slower)."


def _join(*parts: str | None) -> str | None:
    text = " ".join(p for p in parts if p)
    return text or None


def _finish_media(db, v: Video, src: Path) -> str | None:
    """Probe the file and make the playable copy. Success: sets playback_path and status "ready", returns how it was made
    ("ready" or "copied"). Failure: sets status "failed" and returns None."""
    try:
        info = media.probe(src)
        v.duration_s, v.fps = info["duration_s"], info["fps"]
        v.width, v.height, v.vcodec = info.get("width"), info.get("height"), info.get("vcodec")
        playback = video_dir(v.id) / "playback.mp4"
        how = media.make_playback(src, playback, info)
        v.playback_path = str(playback)
        v.status = "ready"
        return how
    except Exception as e:  # noqa: BLE001
        v.status, v.status_reason = "failed", f"Could not prepare video: {str(e)[:300]}"
        return None


@celery.task
def process_upload(video_id: int) -> None:
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v:
            return
        how = _finish_media(db, v, Path(v.file_path))
        if how == "copied":
            v.status_reason = _join(v.status_reason, COPY_NOTE)
        db.commit()


ACTIVE = ("connecting", "recording")  # a video in either state still has (or is waiting for) a recorder


@celery.task
def record_rtsp(video_id: int) -> None:
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v or v.status != "connecting":  # e.g. it was stopped or settled between being created and being picked up
            return
        control.heartbeat(video_id)  # "something is working on this" from the very first moment
        try:
            if control.stop_requested(video_id):  # Stop was pressed while this was still waiting in the queue
                v.status, v.status_reason, v.ended_at = "failed", "Cancelled before the camera connected.", now()
                db.commit()
                return
            url = rtsp.decrypt_url(v.rtsp_url_enc)
            out = Path(v.file_path)

            def on_attempt(n: int, last_error: str) -> None:
                v.status_reason = f"Attempt {n}" + (f" · {last_error}" if last_error else " · connecting…")
                db.commit()

            def on_connected(when) -> None:
                # video is arriving: THIS is when the recording starts
                v.status, v.status_reason, v.started_at = "recording", None, when
                db.commit()

            try:
                res = rtsp.run_recording(url, v.rtsp_minutes, out, should_stop=lambda: control.stop_requested(video_id),
                                         on_tick=lambda: control.heartbeat(video_id), on_attempt=on_attempt, on_connected=on_connected)
            except Exception as e:  # noqa: BLE001
                res = {"status": "failed", "reason": rtsp.scrub(f"Recorder error: {e}", url)}
            v.ended_at = res.get("ended_at") or now()  # when the video stopped arriving (or the stop/attempts ended)
            v.file_size = _size(out)
            if res["status"] == "failed":
                v.status, v.status_reason = "failed", res["reason"]
                db.commit()
            else:
                # The recording is over. From here on it is "saving", not "recording": the timer stops, the camera is free again
                # and Stop no longer applies.
                v.status, v.status_reason = "processing", res["reason"]
                db.commit()
                control.heartbeat(video_id, control.FINISHING_TTL_S)  # still busy: making the playable copy
                how = _finish_media(db, v, out)
                if how is not None:
                    v.status = "partial" if res["status"] == "partial" else "ready"
                    v.status_reason = _join(res["reason"], COPY_NOTE if how == "copied" else None)
                db.commit()
        finally:
            control.clear_heartbeat(video_id)
            control.clear_stop(video_id)


@celery.task
def finalize_recording(video_id: int) -> None:
    """Turn the footage of a recording that lost its recorder into a playable video; it stays marked partial."""
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v or v.status != "processing":
            return
        control.heartbeat(video_id, control.FINISHING_TTL_S)
        try:
            reason = v.status_reason
            how = _finish_media(db, v, Path(v.file_path))
            if how is not None:
                v.status, v.status_reason = "partial", _join(reason, COPY_NOTE if how == "copied" else None)
            db.commit()
        finally:
            control.clear_heartbeat(video_id)


@celery.task
def analyze_stills(video_id: int) -> None:
    """Find the meaningful moments of a video (for "Skip Still Moments"). Only runs when someone asks for it, and stops when
    they cancel (the running flag disappears). A failure here never touches the video or its status."""
    if not control.stills_running(video_id):
        return  # cancelled while waiting in the queue
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v or not v.playback_path or v.video_removed_at is not None or not v.duration_s:
            control.stills_clear(video_id)
            return
        playback, duration, roi = Path(v.playback_path), v.duration_s, v.roi
    try:
        if not playback.exists():
            raise FileNotFoundError(playback)
        stills.analyze(playback, duration, roi, video_path(video_id) / stills.FILE_NAME,
                       should_continue=lambda: control.stills_running(video_id))
        control.stills_clear(video_id)
    except Exception:  # noqa: BLE001
        log.exception("could not analyse the still moments of video %s", video_id)
        control.stills_fail(video_id)


REAP_DELAY_S = 8  # let the other workers answer before judging
MIN_AGE_S = 30  # never judge a recording that was only just requested


def reap_orphans(min_age_s: int = MIN_AGE_S) -> int:
    """Finish recordings that nothing is recording (their worker died). Returns how many were settled."""
    from .orphans import settle_orphan

    with SessionLocal() as db:
        cutoff = now() - timedelta(seconds=min_age_s)
        rows = list(db.scalars(select(Video).where(Video.status.in_(ACTIVE), Video.created_at < cutoff)).all())
        if not rows:
            return 0
        live = liveness.live_among([v.id for v in rows], celery)
        if live is None:
            return 0
        dead = [v for v in rows if v.id not in live]
        for v in dead:
            log.warning("recording %s has no recorder (its worker stopped); settling it", v.id)
            settle_orphan(db, v)
        return len(dead)


@worker_ready.connect
def _on_worker_ready(**_kw) -> None:
    t = threading.Timer(REAP_DELAY_S, lambda: log.info("settled %s orphaned recording(s)", reap_orphans()))
    t.daemon = True
    t.start()


def enqueue(task, video_id: int) -> None:
    task.delay(video_id)
