"""Rebuild the browser playback copy of existing videos (originals are never touched).

Needed once for videos that were processed before frame stepping was tuned: their playback copy has keyframes
only every several seconds, so holding the arrow key freezes the picture.

Usage (from the repo root):
  uv run --project backend python scripts/reprocess_playback.py 3 7      # these video ids
  uv run --project backend python scripts/reprocess_playback.py --all    # every ready/partial video with an original
Add --dry-run to only report the current keyframe spacing."""
import os
import sys
from pathlib import Path

sys.path.insert(0, "backend")
from sqlalchemy import select  # noqa: E402

from app import media  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Video  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
dry = "--dry-run" in sys.argv
if not args and "--all" not in sys.argv:
    sys.exit(__doc__)

with SessionLocal() as db:
    q = select(Video).where(Video.status.in_(["ready", "partial"])).order_by(Video.id)
    if args:
        q = q.where(Video.id.in_([int(a) for a in args]))
    for v in db.scalars(q):
        src = Path(v.file_path or "")
        if not src.exists():
            print(f"video {v.id}: original missing, skipped")
            continue
        info = media.probe(src)
        cur = Path(v.playback_path) if v.playback_path else None
        cur_gap = media.probe_keyframe_gap(cur) if cur and cur.exists() else None
        gap_txt = "unknown" if cur_gap is None else f"{cur_gap:.1f}s"
        if cur_gap is not None and cur_gap <= media.MAX_KEYFRAME_GAP_S:
            print(f"video {v.id} ({v.name}): keyframes every {gap_txt}, already fine")
            continue
        if dry:
            print(f"video {v.id} ({v.name}): keyframes every {gap_txt}, would be rebuilt")
            continue
        dest = (cur or src.with_name("playback.mp4")).with_name("playback.new.mp4")
        media.make_playback(src, dest, info)
        final = cur or src.with_name("playback.mp4")
        os.replace(dest, final)
        v.playback_path, v.duration_s, v.fps = str(final), info["duration_s"], info["fps"]
        db.commit()
        print(f"video {v.id} ({v.name}): rebuilt (keyframes were every {gap_txt}, now {media.probe_keyframe_gap(final):.1f}s)")
