import pytest

from app import rtsp
from app.config import settings

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1?key=abc"


def test_validate_url():
    assert rtsp.validate_rtsp_url(URL) is None
    assert rtsp.validate_rtsp_url("rtsps://h/x") is None
    assert rtsp.validate_rtsp_url("ftp://h/x")
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


def test_preview_says_so_when_the_camera_is_unreachable():
    class R:
        returncode, stdout = 1, b""
        stderr = f"Connection to tcp://10.0.0.5:554?timeout=8000000 failed: Connection timed out ({URL})".encode()
    with pytest.raises(RuntimeError) as e:
        rtsp.grab_frame(URL, run=lambda cmd, **kw: R())
    assert "Could not reach the camera" in str(e.value) and "s3cret" not in str(e.value)


def test_api_validation_and_no_secret_leak(client, auth, monkeypatch):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    url = f"/api/projects/{pid}/videos/rtsp"
    assert client.post(url, json={"url": "ftp://x", "minutes": 5}, headers=auth).status_code == 422
    assert client.post(url, json={"url": URL, "minutes": 999}, headers=auth).status_code == 422
    r = client.post(url, json={"url": URL, "minutes": 5}, headers=auth)
    assert r.status_code == 201 and r.json()["status"] == "connecting"
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
    assert client.post(url, json={"url": "ftp://x"}, headers=auth).status_code == 422
    assert client.post(url, json={"url": URL}).status_code == 401
    monkeypatch.setattr(rtsp, "grab_frame", lambda u: b"\xff\xd8jpg")
    r = client.post(url, json={"url": URL}, headers=auth)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.headers["cache-control"] == "no-store"

    def fail(u):
        raise RuntimeError(f"cannot open {u}")
    monkeypatch.setattr(rtsp, "grab_frame", fail)
    r = client.post(url, json={"url": URL}, headers=auth)
    assert r.status_code == 502 and "s3cret" not in r.text


@pytest.mark.parametrize("err, expected", [
    ("Connection to tcp://h:554?timeout=5000000 failed: Connection timed out", "Could not reach the camera"),
    ("tcp failed: No route to host", "Could not reach the camera"),
    ("Connection refused", "refused the connection"),
    ("method DESCRIBE failed: 401 Unauthorized", "rejected the login"),
    ("method DESCRIBE failed: 404 Not Found", "no stream at this address"),
    ("Name or service not known", "address could not be found"),
])
def test_common_failures_get_a_plain_sentence(err, expected):
    assert expected in rtsp.explain_failure(err)




def test_unknown_failures_keep_the_raw_detail_and_never_the_password(tmp_path, monkeypatch):
    from tests.fakes import DEAD, record
    monkeypatch.setattr(settings, "rtsp_attempt_window_s", 20)
    assert rtsp.explain_failure("something odd") is None
    assert rtsp.explain_failure("") is None
    res, *_ = record(tmp_path, [dict(DEAD, err=f"odd failure for {URL}")])
    assert res["status"] == "failed" and "odd failure" in res["reason"] and "s3cret" not in res["reason"]
