import io
import urllib.error

import pytest

from app import relay, rtsp, snapshot
from app.config import settings

URL = "http://164.52.195.78:8081/latest/store-1/ch9.jpg"
JPEG = b"\xff\xd8\xff\xe0fakejpegdata"


class Resp:
    def __init__(self, body=JPEG, status=200, ctype="image/jpeg"):
        self.body, self.status = body, status
        self.headers = {"Content-Type": ctype}

    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self, n=-1): return self.body if n < 0 else self.body[:n]


def opener(*responses):
    """urlopen stand-in: each call returns/raises the next response; the last one repeats."""
    calls = []

    def f(req, timeout=None):
        calls.append(req)
        r = responses[min(len(calls) - 1, len(responses) - 1)]
        if isinstance(r, Exception):
            raise r
        return r
    f.calls = calls
    return f


def test_validation_accepts_http_links():
    assert rtsp.validate_rtsp_url(URL) is None and rtsp.validate_rtsp_url("https://h/x.jpg") is None
    assert rtsp.validate_rtsp_url("rtsp://h/x") is None
    assert rtsp.validate_rtsp_url("ftp://h/x") and rtsp.validate_rtsp_url("http://") and rtsp.validate_rtsp_url("http://h/a b")


def test_fetch_returns_the_picture():
    assert snapshot.fetch_jpeg(URL, urlopen=opener(Resp())) == JPEG


@pytest.mark.parametrize("err,text", [
    (urllib.error.HTTPError(URL, 401, "x", {}, io.BytesIO()), "wrong login"),
    (urllib.error.HTTPError(URL, 404, "x", {}, io.BytesIO()), "no picture at this address"),
    (urllib.error.HTTPError(URL, 500, "x", {}, io.BytesIO()), "HTTP 500"),
    (urllib.error.URLError("refused"), "Could not reach"),
    (TimeoutError(), "did not answer in time"),
])
def test_fetch_errors_are_plain(err, text):
    with pytest.raises(snapshot.SnapshotError, match=text):
        snapshot.fetch_jpeg(URL, urlopen=opener(err))


def test_not_a_picture():
    with pytest.raises(snapshot.NotAnImage):
        snapshot.fetch_jpeg(URL, urlopen=opener(Resp(b"#EXTM3U", ctype="application/vnd.apple.mpegurl")))
    with pytest.raises(snapshot.SnapshotError, match="JPEG"):
        snapshot.fetch_jpeg(URL, urlopen=opener(Resp(b"<html>", ctype="image/jpeg")))
    with pytest.raises(snapshot.SnapshotError, match="too large"):
        snapshot.fetch_jpeg(URL, urlopen=opener(Resp(JPEG + b"0" * settings.snapshot_max_bytes)))


def test_login_in_the_address_is_sent_as_basic_auth_and_not_in_the_url():
    o = opener(Resp())
    snapshot.fetch_jpeg("http://admin:s3cret@host:8081/a.jpg?x=1", urlopen=o)
    req = o.calls[0]
    assert req.full_url == "http://host:8081/a.jpg?x=1" and req.get_header("Authorization").startswith("Basic ")


def test_is_snapshot_decides_between_pictures_and_streams():
    assert snapshot.is_snapshot(URL, urlopen=opener(Resp()))
    assert not snapshot.is_snapshot(URL, urlopen=opener(Resp(b"--frame", ctype="multipart/x-mixed-replace")))
    assert snapshot.is_snapshot(URL, urlopen=opener(urllib.error.URLError("down")))  # unreachable: stay on the snapshot path


class Pipe:
    def __init__(self, broken_after=None):
        self.data, self.closed, self.broken_after = [], False, broken_after

    def write(self, b):
        if self.broken_after is not None and len(self.data) >= self.broken_after:
            raise BrokenPipeError
        self.data.append(b)

    def flush(self): pass
    def close(self): self.closed = True


class Clock:
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t
    def sleep(self, s): self.t += s


def test_feeder_writes_pictures_and_closes_when_ffmpeg_goes_away():
    c, pipe = Clock(), Pipe(broken_after=5)
    f = snapshot.SnapshotFeeder(URL, pipe, fetch=lambda u: JPEG, clock=c, sleep=c.sleep)
    f.run()
    assert len(pipe.data) == 5 and pipe.closed and f.frames == 5
    assert c.t >= 4 * settings.snapshot_min_interval_s  # never faster than the minimum gap


def test_feeder_skips_bad_pictures_and_gives_up_after_a_while():
    c, pipe = Clock(), Pipe()
    n = {"i": 0}

    def fetch(u):
        n["i"] += 1
        if n["i"] == 2:
            raise snapshot.SnapshotError("The camera server answered HTTP 500")
        if n["i"] > 3:
            raise snapshot.SnapshotError("The camera server did not answer in time")
        return JPEG

    f = snapshot.SnapshotFeeder(URL, pipe, fetch=fetch, clock=c, sleep=c.sleep)
    f.run()
    assert len(pipe.data) == 2 and pipe.closed  # picture 1 and 3; the 500 was skipped; then it gave up
    assert "did not answer" in f.last_error and c.t >= settings.snapshot_fail_s


def test_feeder_stops_on_request_and_closes():
    pipe = Pipe()
    f = snapshot.SnapshotFeeder(URL, pipe, fetch=lambda u: JPEG, clock=Clock(), sleep=lambda s: None)
    f.stop()
    f.run()
    assert pipe.data == [] and pipe.closed


def test_feeder_uses_the_binary_side_of_a_text_pipe():
    class Text(Pipe):
        def __init__(self): super().__init__(); self.buffer = Pipe()

    t = Text()
    f = snapshot.SnapshotFeeder(URL, t, fetch=lambda u: JPEG, clock=Clock(), sleep=lambda s: None)
    f.stream.broken_after = 1
    f.run()
    assert t.buffer.data == [JPEG] and t.closed


def test_ffmpeg_command_reads_stdin():
    cmd = snapshot.build_snapshot_ffmpeg_cmd(2, "o.mp4")
    assert cmd[cmd.index("-i") + 1] == "-" and "-nostdin" in cmd and "120" in cmd
    assert "-use_wallclock_as_timestamps" in cmd and "libx264" in cmd and "expr:gte(t,n_forced*2)" in cmd


def test_grab_frame_returns_the_picture_for_a_snapshot_link(monkeypatch):
    monkeypatch.setattr(snapshot, "fetch_jpeg", lambda url, **kw: JPEG)
    assert rtsp.grab_frame(URL, run=lambda *a, **k: pytest.fail("ffmpeg must not run")) == JPEG


def test_grab_frame_errors_hide_the_password(monkeypatch):
    def boom(url, **kw):
        raise snapshot.SnapshotError("failed for http://admin:s3cret@host/a.jpg")

    monkeypatch.setattr(snapshot, "fetch_jpeg", boom)
    with pytest.raises(RuntimeError) as e:
        rtsp.grab_frame("http://admin:s3cret@host/a.jpg")
    assert "s3cret" not in str(e.value)


def test_http_stream_falls_through_to_ffmpeg(monkeypatch):
    def not_image(url, **kw):
        raise snapshot.NotAnImage("video")

    monkeypatch.setattr(snapshot, "fetch_jpeg", not_image)
    seen = []

    class R:
        returncode, stdout, stderr = 0, b"\xff\xd8jpg", b""

    assert rtsp.grab_frame("http://h/live.m3u8", run=lambda cmd, **kw: (seen.append(cmd), R())[1]) == b"\xff\xd8jpg"
    assert "http://h/live.m3u8" in seen[0]  # read directly: no relay for http


def test_recording_a_snapshot_link_pipes_pictures_into_ffmpeg(monkeypatch, tmp_path):
    monkeypatch.setattr(snapshot, "fetch_jpeg", lambda url, **kw: JPEG)
    monkeypatch.setattr(relay, "open_relay", lambda url: pytest.fail("snapshot links do not use the relay"))
    seen = {}

    class P:
        returncode = 0
        stderr = None

        def __init__(self, cmd, **kw):
            seen["cmd"], seen["stdin"] = cmd, kw["stdin"]
            self.stdin = Pipe()

        def poll(self): return 0
        def send_signal(self, s): pass
        def wait(self, timeout=None): return 0

    class C:
        t = 0.0

        def __call__(self):
            C.t += 100
            return C.t

    res = rtsp.run_recording(URL, 1, tmp_path / "o.mp4", popen=lambda cmd, **kw: P(cmd, **kw), clock=C(), sleep=lambda s: None)
    assert res["status"] == "failed"  # the fake ffmpeg wrote no video; what matters is how it was started
    assert seen["cmd"][seen["cmd"].index("-i") + 1] == "-" and seen["stdin"] is not None
