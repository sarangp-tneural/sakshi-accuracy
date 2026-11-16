from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..comparison import compare, manual_counts
from ..db import get_db
from ..deps import current_user, get_video
from ..models import Mark, MarkingType, SakshiResult, User, Video
from ..schemas import SakshiIO

router = APIRouter(tags=["sakshi"])


def comparison_for(db: Session, video_id: int) -> dict:
    marks = db.scalars(select(Mark).where(Mark.video_id == video_id)).all()
    return compare(manual_counts(marks), db.get(SakshiResult, video_id), _types(db, video_id))


def _types(db: Session, video_id: int) -> list[MarkingType]:
    pid = db.get(Video, video_id).project_id
    return list(db.scalars(select(MarkingType).where(MarkingType.project_id == pid)
                           .order_by(MarkingType.archived, MarkingType.sort_order, MarkingType.id)).all())


def _io(r: SakshiResult | None) -> SakshiIO:
    if r is None:
        return SakshiIO()
    legacy = {k: v for k, v in (("in", r.in_count), ("out", r.out_count), ("male", r.male_count),
                                ("female", r.female_count)) if v is not None}
    return SakshiIO(counts={int(k): v for k, v in (r.counts or {}).items()}, legacy=legacy or None)


@router.get("/videos/{video_id}/sakshi", response_model=SakshiIO)
def get_sakshi(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    return _io(db.get(SakshiResult, video_id))


@router.put("/videos/{video_id}/sakshi", response_model=SakshiIO)
def put_sakshi(video_id: int, body: SakshiIO, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    r = db.get(SakshiResult, video_id)
    if not r:
        r = SakshiResult(video_id=video_id)
        db.add(r)
    valid = {t.id for t in _types(db, video_id)}
    if bad := sorted(set(body.counts) - valid):
        raise HTTPException(422, f"unknown markings: {bad}")
    r.counts = {str(k): v for k, v in body.counts.items()} or None
    db.commit()
    return _io(r)


@router.get("/videos/{video_id}/comparison")
def get_comparison(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    return comparison_for(db, video_id)
