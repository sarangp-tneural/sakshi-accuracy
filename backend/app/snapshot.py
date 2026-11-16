"""Snapshot links: a plain http(s) address that returns the latest picture as one JPEG each time it is fetched
(for example http://host:8081/latest/store-1/ch9.jpg). ffmpeg cannot record that, so a feeder thread fetches the picture
over and over and pipes the pictures into ffmpeg, which turns them into a video. Pictures are fetched as fast as the
server answers (never faster than `snapshot_min_interval_s`)."""
import base64
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit, urlunsplit

from .config import settings

JPEG_START = b"\xff\xd8"


class SnapshotError(RuntimeError):
    """A picture could not be fetched. The message is safe to show (never contains the password)."""


class NotAnImage(SnapshotError):
    """The address answered with something that is not a picture (so it is probably a real video stream)."""


def is_http(url: str) -> bool:
    return url.lower().startswith(("http://", "https://"))


def _request(url: str) -> urllib.request.Request:
    """urllib ignores user:password in the address, so send it as a Basic login and fetch the address without it."""
    parts = urlsplit(url)
    headers = {"User-Agent": "sakshi-verify", "Cache-Control": "no-cache"}
    if parts.username is not None:
        host = parts.hostname or ""
        if ":" in host:
            host = f"[{host}]"
        netloc = host + (f":{parts.port}" if parts.port else "")
        cred = f"{parts.username}:{parts.password or ''}".encode()
        headers["Authorization"] = "Basic " + base64.b64encode(cred).decode()
        url = urlunsplit((parts.scheme, netloc, parts.path, parts.query, ""))
    return urllib.request.Request(url, headers=headers)


def fetch_jpeg(url: str, *, urlopen=urllib.request.urlopen) -> bytes:
    """One picture. Raises NotAnImage for a non-image answer, SnapshotError for anything else that goes wrong."""
    try:
        with urlopen(_request(url), timeout=settings.snapshot_timeout_s) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if r.status != 200:
                raise SnapshotError(f"The camera server answered HTTP {r.status}")
            data = r.read(settings.snapshot_max_bytes + 1)
    except urllib.error.HTTPError as e:
        hint = {401: " (wrong login)", 403: " (not allowed)", 404: " (no picture at this address)"}.get(e.code, "")
        raise SnapshotError(f"The camera server answered HTTP {e.code}{hint}") from None
    except urllib.error.URLError as e:
        raise SnapshotError(f"Could not reach the camera server ({getattr(e, 'reason', e)})") from None
    except (TimeoutError, OSError):
        raise SnapshotError("The camera server did not answer in time") from None
    if len(data) > settings.snapshot_max_bytes:
        raise SnapshotError("The picture is too large")
    if not data.startswith(JPEG_START):
        if ctype and not ctype.startswith("image/"):
            raise NotAnImage(f"The address returns {ctype}, not a picture")
        raise SnapshotError("The camera server did not return a JPEG picture")
    return data


def is_snapshot(url: str, *, urlopen=urllib.request.urlopen) -> bool:
    """True when the address returns pictures. False only when it clearly answers with something else (a video stream).
    When it cannot be reached it is still treated as a snapshot link, so the recording's retries and messages apply."""
    try:
        fetch_jpeg(url, urlopen=urlopen)
    except NotAnImage:
        return False
    except SnapshotError:
        return True
    return True


def build_snapshot_ffmpeg_cmd(minutes: int, out) -> list[str]:
    """ffmpeg reads JPEGs from stdin. Wall-clock timestamps keep video time equal to real time (a frame is shown when it was
    fetched), and a keyframe every 2 s keeps the fragmented file growing (so "connected" and "stalled" work as for RTSP)."""
    return [
        "ffmpeg", "-y", "-nostdin", "-loglevel", "error",
        "-probesize", "150000", "-analyzeduration", "0",  # do not wait to study the pictures: start writing at once
        "-f", "image2pipe", "-c:v", "mjpeg", "-use_wallclock_as_timestamps", "1", "-i", "-",
        "-t", str(minutes * 60), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency", "-pix_fmt", "yuv420p", "-vsync", "vfr",
        "-force_key_frames", "expr:gte(t,n_forced*2)",
        "-f", "mp4", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", str(out),
    ]


class SnapshotFeeder(threading.Thread):
    """Fetch pictures and write them to ffmpeg's stdin until told to stop, ffmpeg goes away, or the server has failed for
    `snapshot_fail_s` in a row. A bad answer is skipped and tried again. stdin is always closed at the end so ffmpeg can
    finish its file."""

    def __init__(self, url: str, stdin, *, fetch=fetch_jpeg, clock=time.monotonic, sleep=time.sleep):
        super().__init__(daemon=True, name="snapshot-feeder")
        self.url, self.fetch, self.clock, self.sleep = url, fetch, clock, sleep
        self.stream = getattr(stdin, "buffer", stdin)  # ffmpeg may have been started in text mode
        self._stdin = stdin
        self._halt = threading.Event()
        self.last_error = ""
        self.frames = 0

    def stop(self) -> None:
        self._halt.set()

    def run(self) -> None:
        failing_since: float | None = None
        try:
            while not self._halt.is_set():
                started = self.clock()
                try:
                    jpeg = self.fetch(self.url)
                except SnapshotError as e:
                    self.last_error = str(e)
                    failing_since = failing_since if failing_since is not None else started
                    if self.clock() - failing_since >= settings.snapshot_fail_s:
                        return
                    self.sleep(max(settings.snapshot_min_interval_s, 0.5))
                    continue
                failing_since = None
                self.last_error = ""
                try:
                    self.stream.write(jpeg)
                    self.stream.flush()
                except (BrokenPipeError, ValueError, OSError):
                    return  # ffmpeg is gone
                self.frames += 1
                wait = settings.snapshot_min_interval_s - (self.clock() - started)
                if wait > 0:
                    self.sleep(wait)
        finally:
            try:
                self._stdin.close()
            except (BrokenPipeError, ValueError, OSError):
                pass
