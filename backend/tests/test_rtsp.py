import pytest

from app import rtsp
from app.config import settings

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1?key=abc"


def test_validate_url():
    assert rtsp.validate_rtsp_url(URL) is None
    assert rtsp.validate_rtsp_url("rtsps://h/x") is None
    assert rtsp.validate_rtsp_url("http://h/x")
    assert rtsp.validate_rtsp_url("rtsp://") 
    assert rtsp.validate_rtsp_url("rtsp://h/a b")


def test_validate_minutes():
    assert rtsp.validate_minutes(1) is None and rtsp.validate_minutes(settings.max_rtsp_minutes) is None
    assert rtsp.validate_minutes(0) and rtsp.validate_minutes(settings.max_rtsp_minutes + 1)


def test_mask_and_scrub():
    m = rtsp.mask_url(URL)
    assert "s3cret" not in m and "admin" not in m and "abc" not in m and "10.0.0.5:554" in m
    err = rtsp.scrub(f"Connection to {URL} failed; user admin pass s3cret", URL)
    assert "s3cret" not in err and "abc" not in err


def test_encrypt_roundtrip():
    tok = rtsp.encrypt_url(URL)
    assert "s3cret" not in tok and rtsp.decrypt_url(tok) == URL


def test_cmd_duration():
    cmd = rtsp.build_ffmpeg_cmd(URL, 3, __import__("pathlib").Path("o.mp4"))
    assert cmd[cmd.index("-t") + 1] == "180" and "copy" in cmd and URL in cmd


class FakeProc:
    def __init__(self, clock, ends_at, rc, err="", out=None, writes=True):
        self.clock, self.ends_at, self.returncode_final, self.err = clock, ends_at, rc, err
        self.returncode = None
        self.killed = False
        import io
        self.stderr = io.StringIO(err)
        if out is not None and writes:
            out.write_bytes(b"data")

    def poll(self):
        if self.killed or self.clock.t >= self.ends_at:
            self.returncode = -9 if self.killed else self.returncode_final
            return self.returncode
        return None

    def kill(self):
        self.killed = True


class Clock:
    t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


def run(tmp_path, ends_at, rc, minutes=1, err="", writes=True):
    c = Clock()
    out = tmp_path / "o.mp4"
    res = rtsp.run_recording(URL, minutes, out, clock=c, sleep=c.sleep,
                             popen=lambda cmd, **kw: FakeProc(c, ends_at, rc, err, out, writes))
    return res


def test_full_duration_saved(tmp_path):
    assert run(tmp_path, 60, 0)["status"] == "saved"


def test_stream_drop_is_partial(tmp_path):
    r = run(tmp_path, 20, 1, err=f"error reading {URL}")
    assert r["status"] == "partial" and "s3cret" not in r["reason"] and "20 s" in r["reason"]


def test_no_file_is_failed(tmp_path):
    r = run(tmp_path, 2, 1, err="Connection refused", writes=False)
    assert r["status"] == "failed" and "Connection refused" in r["reason"]


def test_hung_process_killed(tmp_path):
    r = run(tmp_path, 10_000, 0)
    assert r["status"] == "partial" and "stalled" in r["reason"]


def test_api_validation_and_no_secret_leak(client, auth, monkeypatch):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    url = f"/api/projects/{pid}/videos/rtsp"
    assert client.post(url, json={"url": "http://x", "minutes": 5}, headers=auth).status_code == 422
    assert client.post(url, json={"url": URL, "minutes": 999}, headers=auth).status_code == 422
    r = client.post(url, json={"url": URL, "minutes": 5}, headers=auth)
    assert r.status_code == 201 and r.json()["status"] == "recording"
    assert "s3cret" not in r.text and "admin" not in r.text
    monkeypatch.setattr(settings, "min_free_disk_bytes", 10**18)
    assert client.post(url, json={"url": URL, "minutes": 5}, headers=auth).status_code == 507


def test_upload_type_and_size(client, auth, monkeypatch):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    url = f"/api/projects/{pid}/videos/upload"
    assert client.post(url, files={"file": ("a.txt", b"x")}, headers=auth).status_code == 415
    monkeypatch.setattr(settings, "max_upload_bytes", 10)
    assert client.post(url, files={"file": ("a.mp4", b"x" * 100)}, headers=auth).status_code == 413
    monkeypatch.setattr(settings, "max_upload_bytes", 1000)
    r = client.post(url, files={"file": ("a.mp4", b"x" * 100)}, headers=auth)
    assert r.status_code == 201 and r.json()["status"] == "processing"


# ---- stop + preview ----
class StoppableProc(FakeProc):
    def send_signal(self, sig):
        self.sigint = True
        self.ends_at = 0  # ffmpeg finalizes and exits on SIGINT

    def wait(self, timeout=None):
        self.returncode = 255
        return 255


def test_manual_stop_keeps_file(tmp_path):
    c = Clock()
    out = tmp_path / "o.mp4"
    procs = []

    def popen(cmd, **kw):
        p = StoppableProc(c, 10_000, 0, "", out)
        procs.append(p)
        return p

    res = rtsp.run_recording(URL, 5, out, clock=c, sleep=c.sleep, popen=popen, should_stop=lambda: c.t >= 12)
    assert res["status"] == "stopped" and "12 s" in res["reason"] and procs[0].sigint
    assert out.exists()


def test_manual_stop_without_file_is_failed(tmp_path):
    c = Clock()
    out = tmp_path / "o.mp4"
    res = rtsp.run_recording(URL, 5, out, clock=c, sleep=c.sleep, should_stop=lambda: c.t >= 3,
                             popen=lambda cmd, **kw: StoppableProc(c, 10_000, 0, "", out, writes=False))
    assert res["status"] == "failed" and "Stopped" in res["reason"]


def test_stop_endpoint(client, auth, monkeypatch):
    from app import control
    from app.db import SessionLocal
    from app.models import Video
    from tests.conftest import make_user
    flagged = []
    monkeypatch.setattr(control, "request_stop", lambda vid: flagged.append(vid))
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    vid = client.post(f"/api/projects/{pid}/videos/rtsp", json={"url": URL, "minutes": 5}, headers=auth).json()["id"]
    _, other = make_user("b@x.com")
    assert client.post(f"/api/videos/{vid}/stop", headers=other).status_code == 404 and flagged == []
    r = client.post(f"/api/videos/{vid}/stop", headers=auth)
    assert r.status_code == 200 and flagged == [vid] and "s3cret" not in r.text
    with SessionLocal() as db:
        db.get(Video, vid).status = "ready"
        db.commit()
    assert client.post(f"/api/videos/{vid}/stop", headers=auth).status_code == 409


def test_grab_frame_ok_and_error_scrubbed():
    class R:
        def __init__(self, rc, out=b"", err=b""):
            self.returncode, self.stdout, self.stderr = rc, out, err
    assert rtsp.grab_frame(URL, run=lambda cmd, **kw: R(0, b"\xff\xd8jpg")) == b"\xff\xd8jpg"
    with pytest.raises(RuntimeError) as e:
        rtsp.grab_frame(URL, run=lambda cmd, **kw: R(1, b"", f"failed {URL} pass s3cret".encode()))
    assert "s3cret" not in str(e.value)
    import subprocess

    def boom(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, 15)
    with pytest.raises(RuntimeError, match="15 seconds"):
        rtsp.grab_frame(URL, run=boom)


def test_preview_endpoint(client, auth, monkeypatch):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    url = f"/api/projects/{pid}/rtsp/preview"
    assert client.post(url, json={"url": "http://x"}, headers=auth).status_code == 422
    assert client.post(url, json={"url": URL}).status_code == 401
    monkeypatch.setattr(rtsp, "grab_frame", lambda u: b"\xff\xd8jpg")
    r = client.post(url, json={"url": URL}, headers=auth)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.headers["cache-control"] == "no-store"

    def fail(u):
        raise RuntimeError(f"cannot open {u}")
    monkeypatch.setattr(rtsp, "grab_frame", fail)
    r = client.post(url, json={"url": URL}, headers=auth)
    assert r.status_code == 502 and "s3cret" not in r.text
