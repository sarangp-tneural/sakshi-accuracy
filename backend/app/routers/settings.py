from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import key_registry as kr
from ..db import get_db
from ..deps import current_user
from sqlalchemy import select

from ..models import MarkingType, Project, User, UserSettings
from ..schemas import SettingsIn, SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


def _row(db: Session, user: User) -> UserSettings:
    s = db.get(UserSettings, user.id)
    if not s:
        s = UserSettings(user_id=user.id, reaction_delay_s=0.4, sound_enabled=True, slow_after_jump=False,
                         key_bindings={})
        db.add(s)
        db.flush()
    return s


def _out(s: UserSettings) -> SettingsOut:
    return SettingsOut(reaction_delay_s=s.reaction_delay_s, sound_enabled=s.sound_enabled,
                       slow_after_jump=s.slow_after_jump, key_bindings=kr.merge_with_defaults(s.key_bindings))


def _marking_keys(db: Session, user: User) -> dict[str, str]:
    """Shortcut keys the user's projects use for markings, key -> "label" (a player key must not clash with one)."""
    rows = db.execute(select(MarkingType.key_code, MarkingType.label).join(Project, Project.id == MarkingType.project_id)
                      .where(Project.owner_id == user.id, MarkingType.archived.is_(False))).all()
    return {k: label for k, label in rows}


@router.get("", response_model=SettingsOut)
def get_settings(db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _row(db, user)
    db.commit()
    return _out(s)


@router.put("", response_model=SettingsOut)
def put_settings(body: SettingsIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if errs := kr.validate_bindings(body.key_bindings):
        raise HTTPException(422, "; ".join(errs))
    taken = _marking_keys(db, user)
    for action, code in body.key_bindings.items():
        if code in taken:
            raise HTTPException(409, f'Key {code} is used for the marking "{taken[code]}"')
    s = _row(db, user)
    s.reaction_delay_s, s.sound_enabled, s.slow_after_jump = body.reaction_delay_s, body.sound_enabled, body.slow_after_jump
    s.key_bindings = dict(body.key_bindings)
    db.commit()
    return _out(s)


@router.post("/reset", response_model=SettingsOut)
def reset(action: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Reset all key bindings, or one action (?action=male_in). If the default key of a single
    action is currently held by another action, the two are swapped so there are no duplicates."""
    s = _row(db, user)
    cur = kr.merge_with_defaults(s.key_bindings)
    if action is None:
        cur = dict(kr.DEFAULT_BINDINGS)
    else:
        if action not in kr.ACTIONS:
            raise HTTPException(422, f"unknown action: {action}")
        want = kr.DEFAULT_BINDINGS[action]
        if want in (taken := _marking_keys(db, user)):
            raise HTTPException(409, f'Key {want} is used for the marking "{taken[want]}"')
        holder = next((a for a, k in cur.items() if k == want and a != action), None)
        if holder:
            cur[holder] = cur[action]
        cur[action] = want
    s.key_bindings = cur
    db.commit()
    return _out(s)
