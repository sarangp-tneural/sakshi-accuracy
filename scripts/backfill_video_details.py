"""Fill in file size, resolution, codec (and fps/duration if missing) for videos created before those were stored.

Reads the files on disk; changes nothing else. Start and end times of old RTSP recordings cannot be recovered.
Dry run by default; add --apply to write.

Usage (from the repo root):
  uv run --project backend python scripts/backfill_video_details.py            # show what would change
  uv run --project backend python scripts/backfill_video_details.py --apply    # write it"""
import sys
from pathlib import Path

sys.path.insert(0, "backend")
from sqlalchemy import or_, select  # noqa: E402

from app import media  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import Video  # noqa: E402

apply = "--apply" in sys.argv
changed = skipped = 0
with SessionLocal() as db:
    q = select(Video).where(Video.status.in_(["ready", "partial"]),
                            or_(Video.file_size.is_(None), Video.width.is_(None), Video.height.is_(None), Video.vcodec.is_(None)))
    for v in db.scalars(q.order_by(Video.id)):
        src = Path(v.file_path) if v.file_path else None
        if src is None or not src.is_file():
            print(f"video {v.id} ({v.name}): original file missing, skipped")
            skipped += 1
            continue
        found: dict[str, object] = {}
        if v.file_size is None:
            found["file_size"] = src.stat().st_size
        try:
            info = media.probe(src)
        except Exception as e:  # noqa: BLE001
            info = {}
            print(f"video {v.id} ({v.name}): could not read stream info ({str(e)[:80]})")
        for field, key in (("width", "width"), ("height", "height"), ("vcodec", "vcodec"), ("fps", "fps"), ("duration_s", "duration_s")):
            if getattr(v, field) is None and info.get(key) is not None:
                found[field] = info[key]
        if not found:
            continue
        print(f"video {v.id} ({v.name}): " + ", ".join(f"{k}={val}" for k, val in found.items()))
        if apply:
            for k, val in found.items():
                setattr(v, k, val)
        changed += 1
    if apply:
        db.commit()
print(f"{'updated' if apply else 'would update'} {changed} video(s); {skipped} skipped" + ("" if apply else "  (dry run: add --apply to write)"))
