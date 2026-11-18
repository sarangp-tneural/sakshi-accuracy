"""Start an RTSP recording. Shared by the one-off record endpoint and the saved-camera endpoint."""
from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import rtsp, storage, worker
from .config import settings
from .models import Video


def start_recording(db: Session, *, project_id: int, url: str, minutes: int, name: str | None = None, camera_id: int | None = None,
                    lines: list | None = None, roi: dict | None = None) -> Video:
    """Validate, guard disk space, create the video row (status "connecting": attempting) and queue the recorder."""
    if err := rtsp.validate_rtsp_url(url) or rtsp.validate_minutes(minutes):
        raise HTTPException(422, err)
    storage.ensure_disk_space(minutes * settings.rtsp_bytes_per_minute)
    masked = rtsp.mask_url(url)
    v = Video(project_id=project_id, name=(name or f"RTSP {masked}")[:255], source="rtsp", status="connecting",
              rtsp_url_enc=rtsp.encrypt_url(url), rtsp_url_masked=masked, rtsp_minutes=minutes, camera_id=camera_id, lines=lines or [], roi=roi)
    db.add(v)
    db.flush()
    v.file_path = str(storage.video_dir(v.id) / "original.mp4")
    db.commit()
    worker.enqueue(worker.record_rtsp, v.id)
    db.refresh(v)
    return v
