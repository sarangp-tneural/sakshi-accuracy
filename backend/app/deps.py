from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .db import get_db
from .models import Mark, Project, User, Video
from .security import decode_token


def current_user(request: Request, db: Session = Depends(get_db), token: str | None = Query(None)) -> User:
    """Bearer header, or ?token= (needed by <video> and download links)."""
    auth = request.headers.get("authorization", "")
    raw = auth[7:] if auth.lower().startswith("bearer ") else token
    uid = decode_token(raw) if raw else None
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


def get_project(db: Session, user: User, project_id: int) -> Project:
    p = db.get(Project, project_id)
    if not p or p.owner_id != user.id:
        raise HTTPException(404, "Project not found")
    return p


def get_video(db: Session, user: User, video_id: int) -> Video:
    v = db.get(Video, video_id)
    if not v or db.get(Project, v.project_id).owner_id != user.id:
        raise HTTPException(404, "Video not found")
    return v


def get_mark(db: Session, user: User, mark_id: int) -> Mark:
    m = db.get(Mark, mark_id)
    if not m:
        raise HTTPException(404, "Mark not found")
    get_video(db, user, m.video_id)
    return m
