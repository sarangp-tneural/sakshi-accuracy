"""Find the "meaningful" moments of a video so a reviewer can skip the near-identical ones.

The video is sampled (SAMPLE_FPS) into tiny grey frames, optionally cropped to the focus area. A frame is KEPT when it differs
from the last kept frame (perceptual hash or pixel difference), and always when MAX_GAP_S passed since the last kept one.
Only reads the playable copy; the result is a small JSON file next to it. No video file is ever modified.
"""
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Iterable

import numpy as np

SAMPLE_FPS = 5
SIZE = 64  # frames are scaled to SIZE x SIZE grey for the comparison
HASH_SIZE = 32  # the hash looks at a HASH_SIZE x HASH_SIZE version
PHASH_T = 4  # keep when more than this many of the 64 hash bits changed
DIFF_T = 5.0  # ...or when the mean pixel difference (0..255) is above this
HASH_MIN_DIFF = 2.5  # the hash alone is not trusted on near-flat pictures (its bits are noise): it also needs this much pixel change
MAX_GAP_S = 5.0  # always keep a frame at least this often
VERSION = 1
FILE_NAME = "keyframes.json"


def _dct_matrix(n: int) -> np.ndarray:
    k = np.arange(n)[:, None]
    i = np.arange(n)[None, :]
    m = np.cos(np.pi * (2 * i + 1) * k / (2 * n)) * np.sqrt(2.0 / n)
    m[0] /= np.sqrt(2)
    return m


_DCT = _dct_matrix(HASH_SIZE)


def phash(gray: np.ndarray) -> np.ndarray:
    """64-bit perceptual hash (as a bool array) of a SIZE x SIZE grey frame."""
    f = gray.shape[0] // HASH_SIZE
    small = gray.astype(np.float64).reshape(HASH_SIZE, f, HASH_SIZE, f).mean(axis=(1, 3))
    low = (_DCT @ small @ _DCT.T)[:8, :8].ravel()
    return low > np.median(low[1:])  # the DC term is left out of the median


def select_keyframes(samples: Iterable[tuple[float, np.ndarray]], *, phash_t: int = PHASH_T, diff_t: float = DIFF_T,
                     max_gap_s: float = MAX_GAP_S) -> list[float]:
    """`samples` are (time_s, SIZE x SIZE grey frame) in time order. Returns the times of the frames worth looking at.
    Each frame is compared with the last KEPT frame (not the previous one), so a slow change still adds up."""
    kept: list[float] = []
    ref_hash = ref_pix = None
    for t, gray in samples:
        h = phash(gray)
        pix = gray.astype(np.float32)
        keep = ref_hash is None or t - kept[-1] >= max_gap_s
        if not keep:
            diff = float(np.abs(pix - ref_pix).mean())
            keep = diff > diff_t or (diff > HASH_MIN_DIFF and int(np.count_nonzero(h != ref_hash)) > phash_t)
        if keep:
            kept.append(round(t, 3))
            ref_hash, ref_pix = h, pix
    return kept


def roi_filter(roi: dict | None) -> str:
    """ffmpeg crop filter (with a trailing comma) for a normalised 0..1 rectangle {x, y, w, h}; empty for the whole frame."""
    if not roi:
        return ""
    x, y, w, h = (float(roi[k]) for k in ("x", "y", "w", "h"))
    return f"crop=trunc(iw*{w:.5f}/2)*2:trunc(ih*{h:.5f}/2)*2:trunc(iw*{x:.5f}/2)*2:trunc(ih*{y:.5f}/2)*2,"


def build_cmd(src: Path, roi: dict | None) -> list[str]:
    vf = f"{roi_filter(roi)}fps={SAMPLE_FPS},scale={SIZE}:{SIZE},format=gray"
    low = ["nice", "-n", "10"] if shutil.which("nice") else []  # never slow down recording or making playable copies
    return [*low, "ffmpeg", "-v", "error", "-threads", "2", "-i", str(src), "-an", "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray", "-"]


def read_samples(src: Path, roi: dict | None):
    """Yield (time_s, frame) for each sampled frame, streaming from ffmpeg."""
    size = SIZE * SIZE
    p = subprocess.Popen(build_cmd(src, roi), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        i = 0
        while True:
            buf = p.stdout.read(size)
            if len(buf) < size:
                break
            yield i / SAMPLE_FPS, np.frombuffer(buf, dtype=np.uint8).reshape(SIZE, SIZE)
            i += 1
    finally:
        p.kill()
        p.wait()


def summarize(kept: list[float], duration_s: float, roi: dict | None) -> dict:
    """The JSON stored next to the video. `reviewed_s` is what is left to look at: each kept frame stands for one sample."""
    reviewed = min(duration_s, len(kept) / SAMPLE_FPS)
    return {"version": VERSION, "sample_fps": SAMPLE_FPS, "roi": roi, "duration_s": round(duration_s, 3),
            "kept": kept, "kept_count": len(kept), "reviewed_s": round(reviewed, 3), "saved_s": round(duration_s - reviewed, 3),
            "params": {"phash_t": PHASH_T, "diff_t": DIFF_T, "max_gap_s": MAX_GAP_S}}


class Cancelled(Exception):
    pass


CHECK_EVERY = 50  # samples between asking "should I go on?" (10 s of video)


def analyze(playback: Path, duration_s: float, roi: dict | None, out: Path,
            should_continue: Callable[[], bool] = lambda: True) -> dict | None:
    """Analyse the playable copy and write `out` (atomically). Never touches the video itself.
    Returns None (and writes nothing) if `should_continue` says stop."""
    gen = read_samples(playback, roi)

    def samples():
        for n, s in enumerate(gen):
            if n % CHECK_EVERY == 0 and not should_continue():
                raise Cancelled
            yield s

    try:
        result = summarize(select_keyframes(samples()), duration_s, roi)
    except Cancelled:
        return None
    finally:
        gen.close()  # stops ffmpeg right away
    tmp = out.with_suffix(".tmp")
    tmp.write_text(json.dumps(result))
    tmp.replace(out)
    return result


def load(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data if data.get("version") == VERSION else None
