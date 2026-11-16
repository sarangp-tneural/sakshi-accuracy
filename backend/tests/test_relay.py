import json
import urllib.error

import pytest

from app import relay, rtsp
from app.config import settings

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1"


class FakeApi:
    """Stands in for mediamtx's control API (urllib.request.urlopen)."""

    def __init__(self, add_status=200, down=False, ready=False):
        self.calls, self.add_status, self.down, self.ready = [], add_status, down, ready

    def __call__(self, req, timeout=None):
        if self.down:
            raise urllib.error.URLError("refused")
        path = req.full_url.split("9997", 1)[1]
        body = json.loads(req.data) if req.data else None
        self.calls.append((req.get_method(), path, body))
        if req.get_method() == "POST" and self.add_status != 200:
            raise urllib.error.HTTPError(req.full_url, self.add_status, "bad", {}, None)

        class R:
            status = 200
            def __enter__(s): return s
            def __exit__(s, *a): return False
            def read(s):
                return json.dumps({"ready": self.ready}).encode() if req.get_method() == "GET" else b""
        return R()


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(settings, "rtsp_relay", True)
    fake = FakeApi()
    monkeypatch.setattr(relay.urllib.request, "urlopen", fake)
    return fake


def test_off_uses_the_real_link():
    r = relay.open_relay(URL)
    assert r.url == URL and r.name is None and r.explain() is None
    r.close()  # nothing to do


def test_link_is_registered_and_ffmpeg_gets_a_local_url_without_the_password(on):
    r = relay.open_relay(URL)
    assert r.url == f"rtsp://127.0.0.1:8554/{r.name}" and r.name.startswith("cam-")
    assert "s3cret" not in r.url and "admin" not in r.url
    method, path, body = on.calls[0]
    assert method == "POST" and path == f"/v3/config/paths/add/{r.name}"
    assert body["source"] == URL and body["sourceOnDemand"] is True and body["rtspTransport"] == "tcp"


def test_every_use_gets_its_own_path(on):
    assert relay.open_relay(URL).name != relay.open_relay(URL).name  # a preview cannot cut off a recording


def test_close_deletes_the_path(on):
    r = relay.open_relay(URL)
    r.close()
    assert on.calls[-1][:2] == ("DELETE", f"/v3/config/paths/delete/{r.name}")


def test_relay_not_running_gives_a_clear_error(on):
    on.down = True
    with pytest.raises(relay.RelayError, match="docker compose up -d mediamtx"):
        relay.open_relay(URL)
    relay.Relay("rtsp://x/y", "cam-1").close()  # closing never raises


def test_refused_link(on):
    on.add_status = 400
    with pytest.raises(relay.RelayError, match="refused the camera link"):
        relay.open_relay(URL)


def test_explain_has_no_credentials(on):
    r = relay.open_relay(URL)
    msg = r.explain()
    assert "could not pull the stream" in msg and "s3cret" not in msg
    on.ready = True
    assert r.explain() is None


def test_recording_reads_from_the_relay_and_cleans_up(on, tmp_path):
    cmds = []

    class P:
        returncode = 0
        stderr = None
        def poll(self): return 0
        def send_signal(self, s): pass
        def wait(self, timeout=None): return 0

    class C:  # clock that moves a lot per call so the attempt window runs out
        t = 0.0
        def __call__(self):
            C.t += 100
            return C.t

    out = tmp_path / "o.mp4"
    res = rtsp.run_recording(URL, 1, out, popen=lambda cmd, **kw: (cmds.append(cmd), P())[1], clock=C(), sleep=lambda s: None)
    assert res["status"] == "failed"
    assert cmds and f"rtsp://127.0.0.1:8554/cam-" in cmds[0][cmds[0].index("-i") + 1]
    assert not any("s3cret" in part for part in cmds[0])
    assert any(m == "DELETE" for m, _, _ in on.calls)


def test_recording_fails_clearly_when_the_relay_is_down(on, tmp_path):
    on.down = True
    res = rtsp.run_recording(URL, 1, tmp_path / "o.mp4")
    assert res["status"] == "failed" and "relay is not running" in res["reason"] and res["started_at"] is None


def test_preview_goes_through_the_relay(on, monkeypatch):
    seen = []

    class R:
        returncode, stdout, stderr = 0, b"\xff\xd8jpg", b""

    jpeg = rtsp.grab_frame(URL, run=lambda cmd, **kw: (seen.append(cmd), R())[1])
    assert jpeg == b"\xff\xd8jpg" and "cam-" in seen[0][seen[0].index("-i") + 1]
    assert any(m == "DELETE" for m, _, _ in on.calls)
    on.down = True
    with pytest.raises(RuntimeError, match="relay is not running"):
        rtsp.grab_frame(URL)
