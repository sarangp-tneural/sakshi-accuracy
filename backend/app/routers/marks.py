from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, get_mark, get_video
from ..models import Mark, User
from ..schemas import MarkIn, MarkOut, MarkPatch

router = APIRouter(tags=["marks"])


@router.get("/videos/{video_id}/marks", response_model=list[MarkOut])
def list_marks(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    return db.scalars(select(Mark).where(Mark.video_id == video_id).order_by(Mark.time_s, Mark.id)).all()


@router.post("/videos/{video_id}/marks", response_model=MarkOut, status_code=201)
def create_mark(video_id: int, body: MarkIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    v = get_video(db, user, video_id)
    if v.duration_s is not None and body.time_s > v.duration_s + 1:
        raise HTTPException(422, "time_s is beyond the end of the video")
    m = Mark(video_id=video_id, created_by=user.id, **body.model_dump())
    db.add(m)
    db.commit()
    return m


@router.patch("/marks/{mark_id}", response_model=MarkOut)
def patch_mark(mark_id: int, body: MarkPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = get_mark(db, user, mark_id)
    for k, val in body.model_dump(exclude_unset=True).items():
        if val is None:
            raise HTTPException(422, f"{k} cannot be null")
        setattr(m, k, val)
    db.commit()
    return m


@router.delete("/marks/{mark_id}", status_code=204)
def delete_mark(mark_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    db.delete(get_mark(db, user, mark_id))
    db.commit()


@router.delete("/videos/{video_id}/marks/last", response_model=MarkOut)
def undo_last(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Undo = delete the most recently *created* mark (not the latest by time), atomically."""
    get_video(db, user, video_id)
    m = db.scalar(select(Mark).where(Mark.video_id == video_id).order_by(Mark.id.desc()).limit(1)
                  .with_for_update())
    if not m:
        raise HTTPException(404, "Nothing to undo")
    out = MarkOut.model_validate(m)
    db.delete(m)
    db.commit()
    return out
