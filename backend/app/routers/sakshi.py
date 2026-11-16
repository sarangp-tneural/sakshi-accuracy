from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..comparison import compare, manual_counts
from ..db import get_db
from ..deps import current_user, get_video
from ..models import Mark, MarkingType, SakshiResult, User, Video
from ..metrics import INPUT_FIELDS, evaluate, evaluate_marking, validate, validate_markings
from ..schemas import EvaluationIn, EvaluationOut, MarkingEval, SakshiIO

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


def _marking_rows(cmp: dict, tp_by_type: dict[int, int]) -> list[dict]:
    return [{"id": t["id"], "label": t["label"], "direction": t["direction"], "archived": t["archived"],
             "actual": t["manual"], "system": t["sakshi"], "tp": tp_by_type.get(t["id"])} for t in cmp["types"]]


def _evaluation(db: Session, video_id: int) -> EvaluationOut:
    r = db.get(SakshiResult, video_id)
    cmp = comparison_for(db, video_id)
    actual, system = cmp["total"]["manual"], cmp["total"]["sakshi"]
    inp = {k: getattr(r, k) if r else None for k in INPUT_FIELDS}
    saved = {int(k): v for k, v in ((r.tp_by_type if r else None) or {}).items()}
    rows = _marking_rows(cmp, saved)
    return EvaluationOut(inputs=EvaluationIn(**inp, type_tp=saved), tp_source=r.tp_source if r else "manual",
                         metrics=evaluate(actual, system, inp),
                         types=[MarkingEval(id=x["id"], label=x["label"], direction=x["direction"], archived=x["archived"],
                                            metrics=evaluate_marking(x["actual"], x["system"], x["tp"])) for x in rows],
                         problems=validate(actual, system, inp) + validate_markings(rows))


@router.get("/videos/{video_id}/evaluation", response_model=EvaluationOut)
def get_evaluation(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    return _evaluation(db, video_id)


@router.put("/videos/{video_id}/evaluation", response_model=EvaluationOut)
def put_evaluation(video_id: int, body: EvaluationIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Save TP and the gender numbers. Replaces all six (blank = not entered). Refused if the numbers cannot be right."""
    get_video(db, user, video_id)
    cmp = comparison_for(db, video_id)
    inp = body.model_dump()
    type_tp = inp.pop("type_tp")
    rows = _marking_rows(cmp, type_tp)
    if bad := sorted(set(type_tp) - {x["id"] for x in rows}):
        raise HTTPException(422, f"unknown markings: {bad}")
    if errs := validate(cmp["total"]["manual"], cmp["total"]["sakshi"], inp) + validate_markings(rows):
        raise HTTPException(422, "; ".join(errs))
    r = db.get(SakshiResult, video_id)
    if not r:
        r = SakshiResult(video_id=video_id)
        db.add(r)
    for k, v in inp.items():
        setattr(r, k, v)
    r.tp_by_type = {str(k): v for k, v in type_tp.items()} or None
    r.tp_source = "manual"
    db.commit()
    return _evaluation(db, video_id)
