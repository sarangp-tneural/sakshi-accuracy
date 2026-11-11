"""Finish a recording (or attempt) that nothing is working on any more: its worker was restarted or crashed."""
from pathlib import Path

from sqlalchemy.orm import Session

from . import control, worker
from .models import Video, now

KEPT = "The recorder stopped while this was recording (it was restarted or crashed). The part recorded is kept."
EMPTY = "The recorder stopped before this recording began, so nothing was recorded. Start it again."


def settle_orphan(db: Session, v: Video) -> None:
    """Footage on disk is kept (a worker turns it into a playable video); with none the recording is marked failed."""
    path = Path(v.file_path) if v.file_path else None
    size = path.stat().st_size if path is not None and path.is_file() else 0
    v.ended_at = v.ended_at or now()
    control.clear_stop(v.id)
    if size > 0:
        v.status, v.status_reason, v.file_size = "processing", KEPT, size
        db.commit()
        worker.enqueue(worker.finalize_recording, v.id)
    else:
        v.status, v.status_reason = "failed", EMPTY
        db.commit()
