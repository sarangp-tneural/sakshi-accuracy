import copy

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import rtsp
from ..db import get_db
from ..deps import current_user, get_camera, get_project
from ..models import Camera, User, Video
from ..recording import start_recording
from ..schemas import CameraIn, CameraOut, CameraPatch, LinesIn, RecordCameraIn, RoiIn, VideoOut

router = APIRouter(tags=["cameras"])

MAX_CAMERAS_PER_PROJECT = 20
ACTIVE = ("connecting", "recording")
UNREADABLE = ("The saved link can't be read any more (the server's secret key changed). "
              "Edit the camera and enter the link again.")


def _checked(name: str | None = None, url: str | None = None, minutes: int | None = None) -> None:
    if url is not None and (err := rtsp.validate_rtsp_url(url)):
        raise HTTPException(422, err)
    if minutes is not None and (err := rtsp.validate_minutes(minutes)):
        raise HTTPException(422, err)
    if name is not None and not name.strip():
        raise HTTPException(422, "Give the camera a name")


def _name_taken(db: Session, project_id: int, name: str, except_id: int | None = None) -> bool:
    q = select(Camera.id).where(Camera.project_id == project_id, func.lower(Camera.name) == name.strip().lower())
    if except_id:
        q = q.where(Camera.id != except_id)
    return db.scalar(q) is not None


def _saved_link(c: Camera) -> str:
    try:
        return rtsp.decrypt_url(c.rtsp_url_enc)
    except InvalidToken:
        raise HTTPException(409, UNREADABLE) from None


def _out(db: Session, cams: list[Camera]) -> list[CameraOut]:
    outs = [CameraOut(id=c.id, project_id=c.project_id, name=c.name, rtsp_url_masked=c.rtsp_url_masked,
                      default_minutes=c.default_minutes, created_at=c.created_at, lines=c.lines or [], roi=c.roi) for c in cams]
    if not outs:
        return outs
    by_id = {o.id: o for o in outs}
    ids = list(by_id)
    for cid, last in db.execute(select(Video.camera_id, func.max(func.coalesce(Video.started_at, Video.created_at)))
                                .where(Video.camera_id.in_(ids)).group_by(Video.camera_id)):
        by_id[cid].last_recorded_at = last
    for cid, vid, status, started, created, minutes, note in db.execute(
        select(Video.camera_id, Video.id, Video.status, Video.started_at, Video.created_at, Video.rtsp_minutes, Video.status_reason)
        .where(Video.camera_id.in_(ids), Video.status.in_(ACTIVE)).order_by(Video.id.desc())
    ):
        o = by_id[cid]
        o.recording_video_id, o.recording_status, o.recording_note = vid, status, note  # the oldest active one wins
        o.recording_started_at, o.recording_created_at, o.recording_minutes = started, created, minutes
    return outs


@router.get("/projects/{project_id}/cameras", response_model=list[CameraOut])
def list_cameras(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    cams = list(db.scalars(select(Camera).where(Camera.project_id == project_id).order_by(func.lower(Camera.name))).all())
    return _out(db, cams)


@router.post("/projects/{project_id}/cameras", response_model=CameraOut, status_code=201)
def create_camera(project_id: int, body: CameraIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    url, name = body.url.strip(), body.name.strip()
    _checked(name, url, body.default_minutes)
    if (db.scalar(select(func.count(Camera.id)).where(Camera.project_id == project_id)) or 0) >= MAX_CAMERAS_PER_PROJECT:
        raise HTTPException(409, f"A project can have at most {MAX_CAMERAS_PER_PROJECT} cameras")
    if _name_taken(db, project_id, name):
        raise HTTPException(409, "A camera with this name already exists in the project")
    c = Camera(project_id=project_id, name=name, rtsp_url_enc=rtsp.encrypt_url(url), rtsp_url_masked=rtsp.mask_url(url),
               default_minutes=body.default_minutes)
    db.add(c)
    try:
        db.commit()
    except IntegrityError:  # two creates with the same name at once
        db.rollback()
        raise HTTPException(409, "A camera with this name already exists in the project") from None
    return _out(db, [c])[0]


@router.patch("/cameras/{camera_id}", response_model=CameraOut)
def patch_camera(camera_id: int, body: CameraPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = get_camera(db, user, camera_id)
    url = body.url.strip() if body.url is not None else None
    name = body.name.strip() if body.name is not None else None
    _checked(name, url, body.default_minutes)
    if name is not None:
        if _name_taken(db, c.project_id, name, except_id=c.id):
            raise HTTPException(409, "A camera with this name already exists in the project")
        c.name = name
    if url is not None:  # no url = keep the saved link
        c.rtsp_url_enc, c.rtsp_url_masked = rtsp.encrypt_url(url), rtsp.mask_url(url)
    if body.default_minutes is not None:
        c.default_minutes = body.default_minutes
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A camera with this name already exists in the project") from None
    return _out(db, [c])[0]


@router.put("/cameras/{camera_id}/lines", response_model=CameraOut)
def put_camera_lines(camera_id: int, body: LinesIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Replace the camera's lines. Only recordings started afterwards get them; existing videos keep their own."""
    c = get_camera(db, user, camera_id)
    c.lines = [ln.model_dump() for ln in body.lines]
    db.commit()
    return _out(db, [c])[0]


@router.put("/cameras/{camera_id}/roi", response_model=CameraOut)
def put_camera_roi(camera_id: int, body: RoiIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Set (or clear) the door area. Only recordings started afterwards get it; existing videos keep their own."""
    c = get_camera(db, user, camera_id)
    c.roi = body.roi.model_dump() if body.roi else None
    db.commit()
    return _out(db, [c])[0]


@router.delete("/cameras/{camera_id}", status_code=204)
def delete_camera(camera_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Recordings already made are kept (they just lose the link to the camera)."""
    db.delete(get_camera(db, user, camera_id))
    db.commit()


@router.post("/cameras/{camera_id}/record", response_model=VideoOut, status_code=201)
def record_camera(camera_id: int, body: RecordCameraIn | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """One click: record from the saved link, for `minutes` or the camera's saved length."""
    get_camera(db, user, camera_id)
    # lock the camera row so two quick clicks cannot both pass the "already recording" check
    c = db.scalar(select(Camera).where(Camera.id == camera_id).with_for_update())
    if db.scalar(select(Video.id).where(Video.camera_id == camera_id, Video.status.in_(ACTIVE))) is not None:
        db.rollback()
        raise HTTPException(409, "This camera is already recording")
    minutes = body.minutes if body and body.minutes is not None else c.default_minutes
    try:
        link = _saved_link(c)
        stamp = func.to_char(func.now(), "YYYY-MM-DD HH24:MI")  # name like "Entrance 2026-11-10 18:17"
        label = db.scalar(select(stamp))
        return start_recording(db, project_id=c.project_id, url=link, minutes=minutes, name=f"{c.name} {label}", camera_id=c.id,
                               lines=copy.deepcopy(c.lines or []), roi=copy.deepcopy(c.roi))
    except HTTPException:
        db.rollback()
        raise


@router.post("/cameras/{camera_id}/preview")
def camera_preview(camera_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """One JPEG frame from the saved camera, so you can check the view before recording."""
    c = get_camera(db, user, camera_id)
    link = _saved_link(c)
    try:
        jpeg = rtsp.grab_frame(link)
    except RuntimeError as e:
        raise HTTPException(502, rtsp.scrub(str(e), link)) from None
    return Response(jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
