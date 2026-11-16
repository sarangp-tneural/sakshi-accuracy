"""The markings every new project starts with (the same six the app always had). All of them can be edited or removed."""
from sqlalchemy.orm import Session

from .models import MarkingType

DEFAULT_MARKINGS = [
    # label, direction, key, colour
    ("Male IN", "in", "KeyF", "#3b82f6"),
    ("Male OUT", "out", "KeyD", "#1d4ed8"),
    ("Female IN", "in", "KeyJ", "#ec4899"),
    ("Female OUT", "out", "KeyK", "#be185d"),
    ("IN (gender unknown)", "in", "KeyG", "#64748b"),
    ("OUT (gender unknown)", "out", "KeyH", "#475569"),
]


def seed_defaults(db: Session, project_id: int) -> None:
    for i, (label, direction, key, color) in enumerate(DEFAULT_MARKINGS):
        db.add(MarkingType(project_id=project_id, label=label, direction=direction, key_code=key, color=color,
                           sort_order=i))
