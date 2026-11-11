"""RTSP helpers: validation, masking, encryption, ffmpeg command and the recording runner."""
import base64
import hashlib
import re
import signal
import subprocess
import time
from datetime import datetime, timezone
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


def explain_failure(err: str) -> str | None:
    """A plain sentence for the common ways reaching a camera fails, or None when it is something else."""
    e = (err or "").lower()
    if "timed out" in e or "no route to host" in e or "network is unreachable" in e:
        return "Could not reach the camera (connection timed out). Check that it is switched on and that this computer can reach it (for Tailscale, that both are online)."
    if "connection refused" in e:
        return "The camera refused the connection. Check the port in the link and that the camera's RTSP service is running."
    if "401" in e or "unauthorized" in e:
        return "The camera rejected the login. Check the user name and password in the link."
    if "404" in e or "not found" in e:
        return "The camera has no stream at this address. Check the end of the link (the path)."
    if "name or service not known" in e or "could not resolve" in e or "temporary failure in name resolution" in e:
        return "The camera's address could not be found. Check the host name in the link."
    return None


def build_ffmpeg_cmd(url: str, minutes: int, out: Path) -> list[str]:
    return [
        "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
        "-rtsp_transport", "tcp", "-timeout", str(settings.rtsp_io_timeout_s * 1_000_000), "-i", url,
        "-t", str(minutes * 60), "-c", "copy", "-f", "mp4", "-movflags", "+frag_keyframe+empty_moov",
        str(out),
    ]


def grab_frame(url: str, *, run=subprocess.run) -> bytes:
    """One JPEG frame from the stream, for the pre-record preview. Errors never contain credentials."""
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", "8000000", "-i", url,
           "-frames:v", "1", "-vf", "scale='min(960,iw)':-2", "-f", "image2", "-vcodec", "mjpeg", "pipe:1"]
    try:
        r = run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=15)
    except subprocess.TimeoutExpired:
        raise RuntimeError("The stream did not answer within 15 seconds") from None
    if r.returncode != 0 or not r.stdout:
        err = scrub((r.stderr or b"").decode(errors="replace"), url).strip()[-300:]
        if friendly := explain_failure(err):
            raise RuntimeError(friendly)
        raise RuntimeError(f"Could not read a frame from the stream. {err}".strip())
    return r.stdout


def _terminate(proc, *, sleep=time.sleep) -> None:
    """Ask ffmpeg to finish (SIGINT keeps the file valid), then insist: a recorder stuck on a dead socket may ignore the first signal."""
    for sig, wait_s in ((signal.SIGINT, 8), (signal.SIGTERM, 4)):
        try:
            proc.send_signal(sig)
            proc.wait(timeout=wait_s)
            return
        except subprocess.TimeoutExpired:
            continue
        except (ProcessLookupError, OSError):
            return
    proc.kill()


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _clock_time(dt: datetime) -> str:
    return dt.astimezone().strftime("%H:%M:%S")


def _plain_minutes(seconds: int) -> str:
    m, sec = divmod(int(seconds), 60)
    return f"{m} min" if sec == 0 and m else (f"{m} min {sec} s" if m else f"{sec} s")


def run_recording(url: str, minutes: int, out: Path, *, popen=subprocess.Popen, clock=time.monotonic,
                  sleep=time.sleep, should_stop=lambda: False, getsize=_size, on_tick=lambda: None,
                  on_attempt=lambda n, last_error: None, on_connected=lambda when: None,
                  wall=lambda: datetime.now(timezone.utc)) -> dict:
    """Attempt to connect, then record for `minutes` of video, counted from the moment video starts arriving.

    1. ATTEMPTING: start ffmpeg; "connected" means the output file holds real video (more than `rtsp_min_footage_bytes`).
       A try that exits, or shows no video within `rtsp_attempt_try_s`, is followed (after `rtsp_attempt_retry_s`) by a new
       try, until `rtsp_attempt_window_s` is used up. `on_attempt(n, last_error)` reports each try.
    2. RECORDING: `on_connected(when)` is called once, and `when` is the recording's start time. ffmpeg stops itself at -t;
       a hard kill follows at +30 s. If the file stops growing for `rtsp_stall_s` s, or ffmpeg exits early, the camera is
       considered lost: the recording ends as partial and its end time is the LAST moment video arrived.
    `should_stop` is polled every second (a stop while attempting cancels the attempt). `on_tick` runs every second (heartbeat).
    Returns {status, reason, elapsed, started_at, ended_at, attempts}; status is saved | stopped | partial | failed.
    started_at is None if the camera never connected."""
    limit = minutes * 60
    window_end = clock() + settings.rtsp_attempt_window_s
    attempts, last_error, proc = 0, "", None

    def result(status, reason, *, started=None, ended=None, elapsed=0.0):
        return {"status": status, "reason": reason, "elapsed": elapsed, "started_at": started, "ended_at": ended or wall(), "attempts": attempts}

    def give_up():
        return result("failed", f"The camera did not come online within {_plain_minutes(settings.rtsp_attempt_window_s)} "
                                f"({attempts} attempt{'s' if attempts != 1 else ''}). {last_error}".strip())

    # ---------------- 1. attempting ----------------
    connected = False
    while not connected:
        attempts += 1
        on_attempt(attempts, last_error)
        out.unlink(missing_ok=True)  # nothing left over from the previous try
        proc = popen(build_ffmpeg_cmd(url, minutes, out), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try_start = clock()
        reason = ""
        while proc.poll() is None:
            on_tick()
            if should_stop():
                _terminate(proc)
                out.unlink(missing_ok=True)
                return result("failed", "Cancelled before the camera connected.")
            if getsize(out) >= settings.rtsp_min_footage_bytes:
                connected = True
                break
            if clock() - try_start > settings.rtsp_attempt_try_s:
                _terminate(proc)
                reason = f"no video within {settings.rtsp_attempt_try_s} s"
                break
            if clock() >= window_end:
                _terminate(proc)
                break
            sleep(1)
        if getsize(out) >= settings.rtsp_min_footage_bytes:
            connected = True  # it connected and may even have finished before we looked
        if connected:
            break
        err = scrub((proc.stderr.read() if proc.stderr else "") or "", url).strip()
        last_error = explain_failure(err) or reason or (err.splitlines()[-1][-160:] if err else "no answer from the camera")
        if clock() >= window_end:
            return give_up()
        for _ in range(settings.rtsp_attempt_retry_s):  # wait before the next try, still listening for Stop
            on_tick()
            if should_stop():
                return result("failed", "Cancelled before the camera connected.")
            if clock() >= window_end:
                break
            sleep(1)
        if clock() >= window_end:  # the window ran out while waiting: no further try
            return give_up()

    # ---------------- 2. recording ----------------
    started = wall()
    on_connected(started)
    rec_start = clock()
    last_size, last_growth, last_growth_wall = getsize(out), rec_start, started
    killed = stopped = stalled = False
    while proc.poll() is None:
        on_tick()
        if should_stop():
            stopped = True
            _terminate(proc)
            break
        now_t, size = clock(), getsize(out)
        if size > last_size:
            last_size, last_growth, last_growth_wall = size, now_t, wall()
        if now_t - last_growth > settings.rtsp_stall_s:
            stalled = True
            _terminate(proc)
            break
        if now_t - rec_start > limit + 30:
            proc.kill()
            killed = True
            break
        sleep(1)
    elapsed = clock() - rec_start
    err = scrub((proc.stderr.read() if proc.stderr else "") or "", url).strip()[-400:]
    has_file = getsize(out) > 0
    lost_at = _clock_time(last_growth_wall)
    if stopped:
        if has_file:
            return result("stopped", f"Stopped manually after {int(elapsed)} s", started=started, elapsed=elapsed)
        return result("failed", "Stopped before any video was recorded", started=started, elapsed=elapsed)
    if stalled:
        return result("partial", f"The camera stopped sending video at {lost_at} (nothing new for {settings.rtsp_stall_s} s), so the recording ended there. "
                                 f"Is the camera still online? {err}".strip(), started=started, ended=last_growth_wall, elapsed=elapsed)
    if proc.returncode == 0 and not killed and elapsed >= limit - GRACE_S:
        return result("saved", None, started=started, elapsed=elapsed)
    if killed:
        return result("partial", f"Recording overran its time and was stopped after {int(elapsed)} s. {err}".strip(), started=started, elapsed=elapsed)
    # ffmpeg ended early on its own: the connection was lost at the last moment video arrived
    return result("partial", f"The camera stopped sending video at {lost_at} (the connection was lost). Check that it is still switched on and reachable.",
                  started=started, ended=last_growth_wall, elapsed=elapsed)
