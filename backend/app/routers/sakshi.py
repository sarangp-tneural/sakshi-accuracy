from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..comparison import compare, manual_counts
from ..db import get_db
from ..deps import current_user, get_video
from ..models import Mark, SakshiResult, User
from ..schemas import SakshiIO

router = APIRouter(tags=["sakshi"])


def comparison_for(db: Session, video_id: int) -> dict:
    marks = db.scalars(select(Mark).where(Mark.video_id == video_id)).all()
    return compare(manual_counts(marks), db.get(SakshiResult, video_id))


@router.get("/videos/{video_id}/sakshi", response_model=SakshiIO)
def get_sakshi(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    return db.get(SakshiResult, video_id) or SakshiIO()


@router.put("/videos/{video_id}/sakshi", response_model=SakshiIO)
def put_sakshi(video_id: int, body: SakshiIO, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    r = db.get(SakshiResult, video_id)
    if not r:
        r = SakshiResult(video_id=video_id)
        db.add(r)
    for k, v in body.model_dump().items():
        setattr(r, k, v)
    db.commit()
    return r


@router.get("/videos/{video_id}/comparison")
def get_comparison(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    return comparison_for(db, video_id)
