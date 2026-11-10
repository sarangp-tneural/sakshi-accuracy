import shutil
from pathlib import Path

from fastapi import HTTPException, UploadFile

from .config import settings

ALLOWED_EXT = {".mp4", ".avi", ".mov"}
CHUNK = 1024 * 1024


def video_dir(video_id: int) -> Path:
    d = settings.data_dir / "videos" / str(video_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def free_bytes(path: Path | None = None) -> int:
    p = path or settings.data_dir
    p.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(p).free


def ensure_disk_space(needed: int) -> None:
    if free_bytes() < needed + settings.min_free_disk_bytes:
        raise HTTPException(507, "Not enough free disk space")


def check_upload_name(filename: str) -> str:
    ext = Path(filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, "Only MP4, AVI and MOV files are allowed")
    return ext


async def save_upload(file: UploadFile, dest: Path) -> int:
    """Stream to disk in chunks, enforcing the size limit. Removes the partial file on failure."""
    size = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise HTTPException(413, "File too large")
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, "Empty file")
    return size
