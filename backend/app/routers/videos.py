import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import control, rtsp, storage, worker
from ..config import settings
from ..db import get_db
from ..deps import current_user, get_project, get_video
from ..models import User, Video
from ..schemas import RtspIn, RtspPreviewIn, VideoOut

router = APIRouter(tags=["videos"])


@router.get("/projects/{project_id}/videos", response_model=list[VideoOut])
def list_videos(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    return db.scalars(select(Video).where(Video.project_id == project_id).order_by(Video.id.desc())).all()


@router.post("/projects/{project_id}/videos/upload", response_model=VideoOut, status_code=201)
async def upload_video(project_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                       user: User = Depends(current_user)):
    get_project(db, user, project_id)
    ext = storage.check_upload_name(file.filename or "")
    storage.ensure_disk_space(0)
    v = Video(project_id=project_id, name=Path(file.filename).name[:255], source="upload", status="processing")
    db.add(v)
    db.flush()
    try:
        dest = storage.video_dir(v.id) / f"original{ext}"
        await storage.save_upload(file, dest)
    except BaseException:
        db.rollback()
        shutil.rmtree(storage.video_dir(v.id), ignore_errors=True)
        raise
    v.file_path = str(dest)
    db.commit()
    worker.enqueue(worker.process_upload, v.id)
    db.refresh(v)
    return v


@router.post("/projects/{project_id}/videos/rtsp", response_model=VideoOut, status_code=201)
def record_video(project_id: int, body: RtspIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    url = body.url.strip()
    if err := rtsp.validate_rtsp_url(url) or rtsp.validate_minutes(body.minutes):
        raise HTTPException(422, err)
    storage.ensure_disk_space(body.minutes * settings.rtsp_bytes_per_minute)
    masked = rtsp.mask_url(url)
    v = Video(project_id=project_id, name=(body.name or f"RTSP {masked}")[:255], source="rtsp",
              status="recording", rtsp_url_enc=rtsp.encrypt_url(url), rtsp_url_masked=masked,
              rtsp_minutes=body.minutes)
    db.add(v)
    db.flush()
    v.file_path = str(storage.video_dir(v.id) / "original.mp4")
    db.commit()
    worker.enqueue(worker.record_rtsp, v.id)
    db.refresh(v)
    return v


@router.post("/projects/{project_id}/rtsp/preview")
def rtsp_preview(project_id: int, body: RtspPreviewIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """A single JPEG frame so the user can see the camera before recording. The link is in the body, never the URL."""
    get_project(db, user, project_id)
    url = body.url.strip()
    if err := rtsp.validate_rtsp_url(url):
        raise HTTPException(422, err)
    try:
        jpeg = rtsp.grab_frame(url)
    except RuntimeError as e:
        raise HTTPException(502, rtsp.scrub(str(e), url))
    return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.post("/videos/{video_id}/stop", response_model=VideoOut)
def stop_recording(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Ask the worker to stop an RTSP recording now. The video recorded so far is kept."""
    v = get_video(db, user, video_id)
    if v.status != "recording":
        raise HTTPException(409, "This video is not recording")
    control.request_stop(v.id)
    return v


@router.get("/videos/{video_id}", response_model=VideoOut)
def get_video_ep(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return get_video(db, user, video_id)


@router.get("/videos/{video_id}/stream")
def stream(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    v = get_video(db, user, video_id)
    if not v.playback_path or not Path(v.playback_path).exists():
        raise HTTPException(409, "Video is not ready")
    return FileResponse(v.playback_path, media_type="video/mp4")  # Starlette handles Range


@router.delete("/videos/{video_id}", status_code=204)
def delete_video(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    v = get_video(db, user, video_id)
    if v.status == "recording":
        raise HTTPException(409, "Cannot delete while recording")
    db.delete(v)
    db.commit()
    shutil.rmtree(settings.data_dir / "videos" / str(video_id), ignore_errors=True)
