import logging
import threading
import time
from datetime import timedelta
from pathlib import Path

from celery import Celery
from celery.signals import worker_ready
from sqlalchemy import select

from . import control, liveness, media, rtsp, stills
from .config import settings
from .db import SessionLocal
from .models import Project, Video, now
from .storage import video_dir, video_path

log = logging.getLogger(__name__)
celery = Celery("sakshi", broker=settings.redis_url, backend=settings.redis_url)
celery.conf.task_always_eager = settings.celery_eager
# Making playable copies is heavy. It has its own queue, served by a worker that does ONE at a time (see docs/DEPLOY.md),
# so recordings never wait behind conversions and conversions never fight each other for the CPU.
MEDIA_QUEUE = "media"
celery.conf.task_routes = {
    "app.worker.process_upload": {"queue": MEDIA_QUEUE},
    "app.worker.finalize_recording": {"queue": MEDIA_QUEUE},
    "app.worker.convert_to_h264": {"queue": MEDIA_QUEUE},
}


def _size(path: Path) -> int | None:
    try:
        return path.stat().st_size
    except OSError:
        return None


COPY_NOTE = "The conversion was too slow, so a quick copy was saved instead (frame stepping may be slower)."


def _join(*parts: str | None) -> str | None:
    text = " ".join(p for p in parts if p)
    return text or None


def mark_queued(v: Video) -> None:
    """The playable copy is waiting for the media worker (again): its conversion has not started."""
    v.queued_at, v.converting_at, v.converted_at = now(), None, None


def _convert(db, v: Video, src: Path) -> str | None:
    """_finish_media, with the start and end of the conversion recorded (the start is saved first, so the row can say "compressing")."""
    v.converting_at = now()
    db.commit()
    how = _finish_media(db, v, src)
    v.converted_at = now()
    return how


def _finish_media(db, v: Video, src: Path) -> str | None:
    """Probe the file and make the playable copy. Success: sets playback_path and status "ready", returns how it was made
    ("ready" or "copied"). Failure: sets status "failed" and returns None."""
    started = time.monotonic()
    try:
        info = media.probe(src)
        project = db.get(Project, v.project_id)
        info["keep_format"] = project.keep_format if project else True
        v.duration_s, v.fps = info["duration_s"], info["fps"]
        v.width, v.height, v.vcodec = info.get("width"), info.get("height"), info.get("vcodec")
        playback = video_dir(v.id) / "playback.mp4"
        how = media.make_playback(src, playback, info)
        v.playback_path = str(playback)
        v.playback_size = _size(playback)
        out = media.probe_stream(playback) or {}
        v.playback_vcodec, v.playback_width, v.playback_height, v.playback_fps = (out.get(k) for k in ("vcodec", "width", "height", "fps"))
        v.status = "ready"
        log.info("video %s: playable copy %s in %.0fs (%s %sx%s, %.0fs of video, %.0f MB -> %.0f MB)", v.id, how,
                 time.monotonic() - started, info.get("vcodec"), info.get("width"), info.get("height"), info.get("duration_s") or 0,
                 (_size(src) or 0) / 1e6, (_size(playback) or 0) / 1e6)
        return how
    except Exception as e:  # noqa: BLE001
        log.warning("video %s: could not make the playable copy after %.0fs: %s", v.id, time.monotonic() - started, e)
        v.status, v.status_reason = "failed", f"Could not prepare video: {str(e)[:300]}"
        return None


@celery.task
def process_upload(video_id: int) -> None:
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v:
            return
        how = _convert(db, v, Path(v.file_path))
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
        v.picked_up_at = now()
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
                mark_queued(v)
                db.commit()
                # The playable copy is made by finalize_recording, on the media queue (one conversion at a time).
                finalize_recording.delay(video_id, res["status"] == "partial")
        finally:
            control.clear_heartbeat(video_id)
            control.clear_stop(video_id)


@celery.task
def finalize_recording(video_id: int, partial: bool | None = None) -> None:
    """Turn the footage of a finished recording into a playable video. Marked partial unless the recording was complete.
    When `partial` is not given, a recording that ended with a reason (it was cut short, or lost its recorder) is partial."""
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v or v.status != "processing":
            return
        control.heartbeat(video_id, control.FINISHING_TTL_S)
        try:
            reason = v.status_reason
            if partial is None:
                partial = bool(reason)
            how = _convert(db, v, Path(v.file_path))
            if how is not None:
                v.status = "partial" if partial else "ready"
                v.status_reason = _join(reason, COPY_NOTE if how == "copied" else None)
            db.commit()
        finally:
            control.clear_heartbeat(video_id)


@celery.task
def convert_to_h264(video_id: int, previous_status: str = "ready") -> None:
    """Someone asked to convert a video whose copy does not play (usually HEVC) to H.264, at most 1280 px wide. The old copy is
    kept until the new one is complete; if the conversion fails the video goes back to how it was, with the reason in its note."""
    with SessionLocal() as db:
        v = db.get(Video, video_id)
        if not v or v.status != "processing" or not v.file_path or v.video_removed_at is not None:
            return
        control.heartbeat(video_id, control.FINISHING_TTL_S)
        started = time.monotonic()
        folder = video_dir(video_id)
        final, tmp = folder / "playback.mp4", folder / "playback.h264.mp4"
        v.converting_at = now()
        db.commit()
        try:
            info = media.probe(Path(v.file_path))
            info["keep_format"] = False
            if media.make_playback(Path(v.file_path), tmp, info) != "ready":
                raise RuntimeError("the conversion took too long")
            tmp.replace(final)
            v.playback_path, v.playback_size = str(final), _size(final)
            out = media.probe_stream(final) or {}
            v.playback_vcodec, v.playback_width, v.playback_height, v.playback_fps = (out.get(k) for k in ("vcodec", "width", "height", "fps"))
            v.status = previous_status
            log.info("video %s: converted to H.264 in %.0fs", video_id, time.monotonic() - started)
        except Exception as e:  # noqa: BLE001
            log.warning("video %s: could not convert to H.264: %s", video_id, e)
            tmp.unlink(missing_ok=True)
            v.status, v.status_reason = previous_status, _join(v.status_reason, f"Could not convert to H.264: {str(e)[:300]}")
        finally:
            v.converted_at = now()
            db.commit()
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


def requeue_stuck_processing(min_age_s: int = MIN_AGE_S) -> int:
    """Queue the playable copy again for recordings stuck on "processing": the media worker was restarted while it was
    converting them (or before it picked them up). Anything still queued, running or recently started is left alone."""
    with SessionLocal() as db:
        cutoff = now() - timedelta(seconds=min_age_s)
        rows = list(db.scalars(select(Video).where(Video.status == "processing", Video.source == "rtsp", Video.ended_at < cutoff,
                                                   Video.file_path.is_not(None))).all())
        if not rows:
            return 0
        live = liveness.live_among([v.id for v in rows], celery)
        if live is None:
            return 0
        stuck = [v for v in rows if v.id not in live and v.file_path and Path(v.file_path).is_file()]
        for v in stuck:
            log.warning("recording %s was left on processing (its media worker stopped); converting it again", v.id)
            mark_queued(v)
            db.commit()
            enqueue(finalize_recording, v.id)
        return len(stuck)


def _on_start() -> None:
    log.info("settled %s orphaned recording(s)", reap_orphans())
    log.info("queued %s recording(s) stuck on processing", requeue_stuck_processing())


@worker_ready.connect
def _on_worker_ready(**_kw) -> None:
    t = threading.Timer(REAP_DELAY_S, _on_start)
    t.daemon = True
    t.start()


def enqueue(task, video_id: int) -> None:
    task.delay(video_id)
