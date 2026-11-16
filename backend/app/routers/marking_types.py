from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import key_registry as kr
from ..db import get_db
from ..deps import current_user, get_project
from ..models import Mark, MarkingType, User, UserSettings
from ..schemas import MarkingOrderIn, MarkingTypeIn, MarkingTypeOut, MarkingTypePatch

router = APIRouter(tags=["marking types"])


def get_type(db: Session, user: User, type_id: int) -> MarkingType:
    t = db.get(MarkingType, type_id)
    if not t:
        raise HTTPException(404, "Marking not found")
    get_project(db, user, t.project_id)
    return t


def _out(db: Session, types: list[MarkingType]) -> list[MarkingTypeOut]:
    counts = dict(db.execute(select(Mark.marking_type_id, func.count()).where(
        Mark.marking_type_id.in_([t.id for t in types])).group_by(Mark.marking_type_id)).all()) if types else {}
    return [MarkingTypeOut.model_validate(t).model_copy(update={"mark_count": counts.get(t.id, 0)}) for t in types]


def project_types(db: Session, project_id: int) -> list[MarkingType]:
    return list(db.scalars(select(MarkingType).where(MarkingType.project_id == project_id)
                           .order_by(MarkingType.archived, MarkingType.sort_order, MarkingType.id)).all())


def _check_key(db: Session, user: User, project_id: int, key: str, ignore_id: int | None = None) -> None:
    if not kr.is_allowed_key(key):
        raise HTTPException(422, f"That key cannot be used: {key}")
    for t in project_types(db, project_id):
        if t.id != ignore_id and not t.archived and t.key_code == key:
            raise HTTPException(409, f'Key {key} is already used by "{t.label}"')
    s = db.get(UserSettings, user.id)
    for action, code in kr.merge_with_defaults(s.key_bindings if s else None).items():
        if code == key:
            raise HTTPException(409, f"Key {key} is already used by the player action \"{action}\"")


@router.get("/projects/{project_id}/marking-types", response_model=list[MarkingTypeOut])
def list_types(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    return _out(db, project_types(db, project_id))


@router.post("/projects/{project_id}/marking-types", response_model=MarkingTypeOut, status_code=201)
def create_type(project_id: int, body: MarkingTypeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    _check_key(db, user, project_id, body.key_code)
    last = db.scalar(select(func.max(MarkingType.sort_order)).where(MarkingType.project_id == project_id))
    t = MarkingType(project_id=project_id, label=body.label.strip(), direction=body.direction, key_code=body.key_code,
                    color=body.color, sort_order=(last if last is not None else -1) + 1)
    db.add(t)
    db.commit()
    return _out(db, [t])[0]


@router.patch("/marking-types/{type_id}", response_model=MarkingTypeOut)
def patch_type(type_id: int, body: MarkingTypePatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = get_type(db, user, type_id)
    if t.archived:
        raise HTTPException(409, "This marking was removed")
    data = body.model_dump(exclude_unset=True)
    if data.get("label") is None:
        data.pop("label", None)
    if data.get("key_code") is None:
        data.pop("key_code", None)
    else:
        _check_key(db, user, t.project_id, data["key_code"], ignore_id=t.id)
    if "label" in data:
        data["label"] = data["label"].strip()
    for k, v in data.items():
        setattr(t, k, v)
    if "direction" in data:  # keep the marks' copy of the direction in step, so the totals follow
        for m in db.scalars(select(Mark).where(Mark.marking_type_id == t.id)):
            m.direction = t.direction
    db.commit()
    return _out(db, [t])[0]


@router.delete("/marking-types/{type_id}", status_code=204)
def delete_type(type_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Remove a marking. One that already has marks is archived (hidden, but old marks keep their label)."""
    t = get_type(db, user, type_id)
    used = db.scalar(select(func.count()).select_from(Mark).where(Mark.marking_type_id == t.id))
    if used:
        t.archived = True
    else:
        db.delete(t)
    db.commit()


@router.put("/projects/{project_id}/marking-types/order", response_model=list[MarkingTypeOut])
def reorder(project_id: int, body: MarkingOrderIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_project(db, user, project_id)
    types = {t.id: t for t in project_types(db, project_id) if not t.archived}
    if set(body.ids) != set(types):
        raise HTTPException(422, "ids must list every current marking exactly once")
    for i, tid in enumerate(body.ids):
        types[tid].sort_order = i
    db.commit()
    return _out(db, project_types(db, project_id))
