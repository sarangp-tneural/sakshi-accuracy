import json
import subprocess
from pathlib import Path


def probe(path: Path) -> dict:
    """Return {duration_s, fps, vcodec, container} via ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, timeout=60, check=True,
    ).stdout
    data = json.loads(out)
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if not v:
        raise ValueError("No video stream found")
    fps = 0.0
    try:
        n, d = v.get("avg_frame_rate", "0/1").split("/")
        fps = float(n) / float(d) if float(d) else 0.0
    except ValueError:
        pass
    dur = data.get("format", {}).get("duration") or v.get("duration")
    return {
        "duration_s": float(dur) if dur else None,
        "fps": fps or None,
        "vcodec": v.get("codec_name"),
        "container": data.get("format", {}).get("format_name", ""),
    }


def make_playback(src: Path, dest: Path, info: dict) -> None:
    """Browser-playable MP4 (H.264 + AAC, faststart). Original is never touched."""
    if info.get("vcodec") == "h264" and "mp4" in info.get("container", "") and src.suffix.lower() == ".mp4":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(dest)]
    else:
        cmd = ["ffmpeg", "-y", "-i", str(src), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(dest)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-500:])
