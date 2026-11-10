import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy import and_, exists, func, not_, or_, select
from sqlalchemy.orm import Session

from .. import control, rtsp, storage, worker
from ..config import settings
from ..db import get_db
from ..deps import current_user, get_project, get_video
from ..models import Mark, SakshiResult, User, Video
from ..schemas import RtspIn, RtspPreviewIn, VideoListOut, VideoOut

router = APIRouter(tags=["videos"])


STATUSES = ("ready", "recording", "processing", "partial", "failed")
BUSY = ("recording", "processing")
StatusT = Literal["ready", "recording", "processing", "partial", "failed"]


def _sakshi_has_value():
    """A saved all-blank Sakshi form does not count as a result."""
    return or_(SakshiResult.in_count.isnot(None), SakshiResult.out_count.isnot(None),
               SakshiResult.male_count.isnot(None), SakshiResult.female_count.isnot(None))


def with_summary(db: Session, videos: list[Video]) -> list[VideoOut]:
    """VideoOut for each video, with its mark counts and whether a Sakshi result was entered (two small grouped queries)."""
    outs = [VideoOut.model_validate(v) for v in videos]
    if not outs:
        return outs
    by_id = {o.id: o for o in outs}
    ids = list(by_id)
    for vid, direction, gender, n in db.execute(
        select(Mark.video_id, Mark.direction, Mark.gender, func.count()).where(Mark.video_id.in_(ids))
        .group_by(Mark.video_id, Mark.direction, Mark.gender)
    ):
        o = by_id[vid]
        o.mark_total += n
        if direction == "in":
            o.mark_in += n
        else:
            o.mark_out += n
        if gender == "male":
            o.mark_male += n
        elif gender == "female":
            o.mark_female += n
    for (vid,) in db.execute(select(SakshiResult.video_id).where(SakshiResult.video_id.in_(ids), _sakshi_has_value())):
        by_id[vid].sakshi_entered = True
    for o in outs:
        o.mark_unknown = o.mark_total - o.mark_male - o.mark_female
    return outs


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _like(text: str) -> str:
    """Escape LIKE wildcards so a search for '50%' matches the text, not everything."""
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


@router.get("/projects/{project_id}/videos", response_model=VideoListOut)
def list_videos(
    project_id: int,
    q: str | None = Query(None, max_length=100),
    status: list[StatusT] = Query(default=[]),
    source: Literal["upload", "rtsp"] | None = None,
    progress: Literal["not_started", "counting", "compared"] | None = None,
    added_from: datetime | None = None,
    added_to: datetime | None = None,
    sort: Literal["newest", "oldest", "name", "duration"] = "newest",
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    """Videos of a project with search, filters, sort and paging. A constant number of queries however many videos exist."""
    get_project(db, user, project_id)
    added_from, added_to = _utc(added_from), _utc(added_to)
    if added_from and added_to and added_from > added_to:
        raise HTTPException(422, "added_from must not be after added_to")

    marks = select(Mark.video_id.label("vid"), func.count().label("n")).group_by(Mark.video_id).subquery()
    sakshi = select(SakshiResult.video_id.label("vid")).where(_sakshi_has_value()).subquery()
    n_marks = func.coalesce(marks.c.n, 0)
    compared = sakshi.c.vid.isnot(None)

    def joined(stmt):
        return stmt.select_from(Video).outerjoin(marks, marks.c.vid == Video.id).outerjoin(sakshi, sakshi.c.vid == Video.id)

    def conditions(with_status: bool):
        c = [Video.project_id == project_id]
        if q and q.strip():
            c.append(Video.name.ilike(_like(q.strip()), escape="\\"))
        if with_status and status:
            c.append(Video.status.in_(status))
        if source:
            c.append(Video.source == source)
        if progress == "compared":
            c.append(compared)
        elif progress == "counting":
            c.append(and_(n_marks > 0, not_(compared)))
        elif progress == "not_started":
            c.append(and_(n_marks == 0, not_(compared)))
        if added_from:
            c.append(Video.created_at >= added_from)
        if added_to:
            c.append(Video.created_at <= added_to)
        return c

    total = db.scalar(joined(select(func.count(Video.id))).where(*conditions(True))) or 0

    counts = {s: 0 for s in STATUSES}
    for st, n in db.execute(joined(select(Video.status, func.count())).where(*conditions(False)).group_by(Video.status)):
        counts[st] = n
    status_counts = {"all": sum(counts.values()), **counts}

    busy = bool(db.scalar(select(exists().where(Video.project_id == project_id, Video.status.in_(BUSY)))))

    order = {
        "newest": (Video.created_at.desc(), Video.id.desc()),
        "oldest": (Video.created_at.asc(), Video.id.asc()),
        "name": (func.lower(Video.name).asc(), Video.id.asc()),
        "duration": (Video.duration_s.desc().nulls_last(), Video.id.desc()),
    }[sort]
    rows = list(db.scalars(joined(select(Video)).where(*conditions(True)).order_by(*order)
                           .limit(page_size).offset((page - 1) * page_size)).all())
    return VideoListOut(items=with_summary(db, rows), total=total, page=page, page_size=page_size,
                        status_counts=status_counts, busy=busy)


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
        size = await storage.save_upload(file, dest)
    except BaseException:
        db.rollback()
        shutil.rmtree(storage.video_dir(v.id), ignore_errors=True)
        raise
    v.file_path = str(dest)
    v.file_size = size
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
    return with_summary(db, [get_video(db, user, video_id)])[0]


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
