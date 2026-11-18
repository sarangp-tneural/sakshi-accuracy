"""Find the still moments of existing videos, for "Skip Still Moments" (new videos are analysed automatically).
Only reads the playable copy and writes keyframes.json next to it; no video file is changed.

Usage (from the repo root):
  uv run --project backend python scripts/backfill_stills.py 3 7      # these video ids
  uv run --project backend python scripts/backfill_stills.py --all    # every ready/partial video without a result
Add --dry-run to only list what would be analysed."""
import sys
from pathlib import Path

sys.path.insert(0, "backend")
from sqlalchemy import select  # noqa: E402

from app import stills  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Project, Video  # noqa: E402
from app.storage import video_path  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
dry = "--dry-run" in sys.argv
if not args and "--all" not in sys.argv:
    sys.exit(__doc__)

with SessionLocal() as db:
    q = select(Video).where(Video.status.in_(["ready", "partial"]), Video.video_removed_at.is_(None)).order_by(Video.id)
    if args:
        q = q.where(Video.id.in_([int(a) for a in args]))
    for v in db.scalars(q):
        playback = Path(v.playback_path) if v.playback_path else None
        out = video_path(v.id) / stills.FILE_NAME
        if playback is None or not playback.is_file() or not v.duration_s:
            print(f"video {v.id}: no playable copy, skipped")
        elif not args and not db.get(Project, v.project_id).still_moments:
            print(f"video {v.id} ({v.name}): still moments are off for its project, skipped")
        elif not args and stills.load(out):
            print(f"video {v.id} ({v.name}): already analysed")
        elif dry:
            print(f"video {v.id} ({v.name}): would be analysed")
        else:
            r = stills.analyze(playback, v.duration_s, v.roi, out)
            print(f"video {v.id} ({v.name}): {r['kept_count']} moments, {r['saved_s'] / 60:.1f} min saved")
