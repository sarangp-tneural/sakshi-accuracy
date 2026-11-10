"""RTSP helpers: validation, masking, encryption, ffmpeg command and the recording runner."""
import base64
import hashlib
import re
import signal
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from cryptography.fernet import Fernet

from .config import settings

GRACE_S = 5  # allowed shortfall before we call a recording "partial"


def validate_rtsp_url(url: str) -> str | None:
    """Return error string or None."""
    if not url.lower().startswith(("rtsp://", "rtsps://")):
        return "Link must start with rtsp:// or rtsps://"
    try:
        parts = urlsplit(url)
    except ValueError:
        return "Invalid link"
    if not parts.hostname:
        return "Link has no host"
    if re.search(r"\s", url):
        return "Link must not contain spaces"
    return None


def validate_minutes(minutes: int) -> str | None:
    if minutes < 1 or minutes > settings.max_rtsp_minutes:
        return f"Minutes must be between 1 and {settings.max_rtsp_minutes}"
    return None


def mask_url(url: str) -> str:
    parts = urlsplit(url)
    host = parts.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    if parts.port:
        host += f":{parts.port}"
    if parts.username or parts.password:
        host = "***:***@" + host
    return urlunsplit((parts.scheme, host, parts.path, "***" if parts.query else "", ""))


def scrub(text: str, url: str) -> str:
    """Remove the secret parts of the URL (and any rtsp:// credentials) from log/error text."""
    parts = urlsplit(url)
    for secret in filter(None, [parts.password, parts.username, parts.query]):
        text = text.replace(secret, "***")
    text = text.replace(url, mask_url(url))
    return re.sub(r"(rtsps?://)[^/@\s]+@", r"\1***:***@", text)


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.secret_key.encode()).digest())
    return Fernet(key)


def encrypt_url(url: str) -> str:
    return _fernet().encrypt(url.encode()).decode()


def decrypt_url(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def build_ffmpeg_cmd(url: str, minutes: int, out: Path) -> list[str]:
    return [
        "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
        "-rtsp_transport", "tcp", "-i", url,
        "-t", str(minutes * 60), "-c", "copy", "-f", "mp4", "-movflags", "+frag_keyframe+empty_moov",
        str(out),
    ]


def grab_frame(url: str, *, run=subprocess.run) -> bytes:
    """One JPEG frame from the stream, for the pre-record preview. Errors never contain credentials."""
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp", "-i", url,
           "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"]
    try:
        r = run(cmd, capture_output=True, timeout=15)
    except subprocess.TimeoutExpired:
        raise RuntimeError("The stream did not answer within 15 seconds") from None
    if r.returncode != 0 or not r.stdout:
        err = scrub((r.stderr or b"").decode(errors="replace"), url).strip()[-300:]
        raise RuntimeError(f"Could not read a frame from the stream. {err}".strip())
    return r.stdout


def run_recording(url: str, minutes: int, out: Path, *, popen=subprocess.Popen, clock=time.monotonic,
                  sleep=time.sleep, should_stop=lambda: False) -> dict:
    """Run ffmpeg for `minutes`. Returns {status, reason, elapsed}.
    status: saved | stopped | partial | failed. ffmpeg itself stops at -t; we add a hard kill after +30 s.
    `should_stop` is polled every second; when true ffmpeg gets SIGINT so the file is finalized and kept."""
    limit = minutes * 60
    proc = popen(build_ffmpeg_cmd(url, minutes, out), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                 text=True)
    start = clock()
    killed = stopped = False
    while proc.poll() is None:
        if should_stop():
            stopped = True
            proc.send_signal(signal.SIGINT)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                proc.kill()
            break
        if clock() - start > limit + 30:
            proc.kill()
            killed = True
            break
        sleep(1)
    elapsed = clock() - start
    err = scrub((proc.stderr.read() if proc.stderr else "") or "", url).strip()[-400:]
    has_file = out.exists() and out.stat().st_size > 0
    if stopped:
        if has_file:
            return {"status": "stopped", "reason": f"Stopped manually after {int(elapsed)} s", "elapsed": elapsed}
        return {"status": "failed", "reason": "Stopped before any video was recorded", "elapsed": elapsed}
    if proc.returncode == 0 and not killed and elapsed >= limit - GRACE_S:
        return {"status": "saved", "reason": None, "elapsed": elapsed}
    if has_file:
        why = "Stream dropped before the requested duration"
        if killed:
            why = "Recording stalled and was stopped"
        return {"status": "partial", "reason": f"{why} after {int(elapsed)} s. {err}".strip(), "elapsed": elapsed}
    return {"status": "failed", "reason": f"Could not record the stream. {err}".strip(), "elapsed": elapsed}
