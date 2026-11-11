import json
import subprocess
from pathlib import Path


# Frame-by-frame stepping seeks to arbitrary frames. The browser has to decode from the previous keyframe every time,
# so a playback copy with a keyframe every few seconds freezes while the arrow key is held (worst going backwards).
# Keep a keyframe at least this often; a 1 s keyframe interval costs only a few percent in file size.
MAX_KEYFRAME_GAP_S = 1.5
KEYFRAME_SAMPLE_PACKETS = 600


def max_keyframe_gap(packets: list[tuple[float, bool]]) -> float | None:
    """Longest time between two keyframes in a sample of (pts_time, is_keyframe) packets.
    One keyframe in the whole sample means the gap is at least as long as the sample; none at all means unknown."""
    pts = sorted(t for t, _ in packets)
    keys = sorted(t for t, k in packets if k)
    if not keys:
        return None
    if len(keys) == 1:
        span = pts[-1] - keys[0] if pts else 0.0
        return span if span > 0 else 0.0
    return max(b - a for a, b in zip(keys, keys[1:]))


def probe_keyframe_gap(path: Path) -> float | None:
    """Longest keyframe gap within the first packets of the file (cheap: reads only the packet headers)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-read_intervals", f"%+#{KEYFRAME_SAMPLE_PACKETS}",
             "-show_entries", "packet=pts_time,flags", "-of", "csv=p=0", str(path)],
            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60, check=True,
        ).stdout
    except (subprocess.SubprocessError, OSError):
        return None
    packets: list[tuple[float, bool]] = []
    for line in out.splitlines():
        t, _, flags = line.partition(",")
        try:
            packets.append((float(t), "K" in flags))
        except ValueError:
            continue
    return max_keyframe_gap(packets) if packets else None


def probe(path: Path) -> dict:
    """Return {duration_s, fps, vcodec, width, height, container, max_keyframe_gap_s} via ffprobe."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60, check=True,
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
        "width": v.get("width"),
        "height": v.get("height"),
        "container": data.get("format", {}).get("format_name", ""),
        "max_keyframe_gap_s": probe_keyframe_gap(path),
    }


def build_playback_cmd(src: Path, dest: Path, info: dict) -> list[str]:
    """ffmpeg command for the browser-playable copy (H.264 + AAC, faststart). The original is never touched.
    A plain remux is used only when the source is already H.264 in MP4 *and* has frequent keyframes;
    otherwise it is re-encoded with a keyframe about every second so frame stepping stays smooth."""
    gap = info.get("max_keyframe_gap_s")
    remux_ok = (info.get("vcodec") == "h264" and "mp4" in info.get("container", "") and src.suffix.lower() == ".mp4"
                and gap is not None and gap <= MAX_KEYFRAME_GAP_S)
    if remux_ok:
        return ["ffmpeg", "-y", "-nostdin", "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(dest)]
    gop = str(max(1, round(info.get("fps") or 25)))
    return ["ffmpeg", "-y", "-nostdin", "-i", str(src), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-g", gop, "-keyint_min", gop, "-sc_threshold", "0",
            "-c:a", "aac", "-movflags", "+faststart", str(dest)]


def playback_timeout_s(duration_s: float | None) -> float:
    """How long the playable copy may take: generous (even at half real-time speed) but never unbounded."""
    return 600 + 2 * max(0.0, duration_s or 0.0)


def quick_copy_cmd(src: Path, dest: Path) -> list[str]:
    return ["ffmpeg", "-y", "-nostdin", "-i", str(src), "-c", "copy", "-movflags", "+faststart", str(dest)]


def make_playback(src: Path, dest: Path, info: dict, run=subprocess.run) -> str:
    """Create the playable copy. Returns how: "ready" (as planned) or "copied" (the conversion was too slow, so a quick copy
    was made instead: watchable, but frame stepping may be slower). Never reads the terminal and never hangs."""
    cmd = build_playback_cmd(src, dest, info)
    try:
        r = run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=playback_timeout_s(info.get("duration_s")))
    except subprocess.TimeoutExpired:
        r = run(quick_copy_cmd(src, dest), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=600)
        if r.returncode != 0:
            raise RuntimeError("The conversion took too long and a quick copy was not possible: " + (r.stderr or "")[-300:])
        return "copied"
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-500:])
    return "ready"
