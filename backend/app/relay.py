"""RTSP relay (mediamtx). ffmpeg cannot do the digest auth of some cameras, mediamtx can, so every recording and preview
pulls from a local, unauthenticated copy of the stream. The user still enters the normal rtsp://user:pass@host link:
we register it with mediamtx under a one-off path name (random, never containing the link) and give ffmpeg the local URL.
The link is only sent to mediamtx on this machine (control API bound to 127.0.0.1)."""
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .config import settings


class RelayError(RuntimeError):
    """The relay could not be used. The message is safe to show (no credentials)."""


NOT_RUNNING = "The RTSP relay is not running. Start it with `docker compose up -d mediamtx` (or set RTSP_RELAY=false to connect directly)."


def _call(method: str, path: str, body: dict | None = None, *, timeout: float = 5.0) -> tuple[int, dict | None]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(settings.rtsp_relay_api.rstrip("/") + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise RelayError(NOT_RUNNING) from e


@dataclass
class Relay:
    url: str  # what ffmpeg should open
    name: str | None = None  # the mediamtx path (None = relay off, url is the real link)

    def explain(self) -> str | None:
        """Why the stream is not coming through, as far as mediamtx can tell (never contains the link)."""
        if not self.name:
            return None
        try:
            status, info = _call("GET", f"/v3/paths/get/{urllib.parse.quote(self.name)}")
        except RelayError as e:
            return str(e)
        if status == 404:
            return "The relay lost this stream."
        if info is not None and not info.get("ready"):
            return ("The relay could not pull the stream from the camera. Check the link, the camera's login, and that this "
                    "computer can reach it (the exact reason is in `docker compose logs mediamtx`).")
        return None

    def close(self) -> None:
        """Forget the path. Best effort: mediamtx keeps nothing on disk and a stale path is harmless."""
        if not self.name:
            return
        try:
            _call("DELETE", f"/v3/config/paths/delete/{urllib.parse.quote(self.name)}", timeout=3.0)
        except RelayError:
            pass


def open_relay(real_url: str) -> Relay:
    """Register `real_url` with mediamtx and return the local URL to record from. Off: the real link is used as is."""
    if not settings.rtsp_relay:
        return Relay(real_url)
    name = "cam-" + secrets.token_hex(8)  # one path per use, so a preview can never cut off a recording of the same camera
    status, _ = _call("POST", f"/v3/config/paths/add/{name}", {
        "source": real_url, "sourceOnDemand": True, "sourceOnDemandCloseAfter": "30s", "rtspTransport": "tcp",
    })
    if status != 200:
        raise RelayError(f"The RTSP relay refused the camera link (HTTP {status}). Check that it is a valid rtsp:// link.")
    return Relay(f"rtsp://{settings.rtsp_relay_host}:{settings.rtsp_relay_port}/{name}", name)
