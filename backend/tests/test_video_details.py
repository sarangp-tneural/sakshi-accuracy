from datetime import datetime, timedelta, timezone
from pathlib import Path

from app import control, media, rtsp, worker
from app.db import SessionLocal
from app.models import Mark, SakshiResult, Video
from tests.conftest import make_user

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1"


def add_marks(video_id, uid, rows):
    with SessionLocal() as db:
        for direction, gender in rows:
            db.add(Mark(video_id=video_id, time_s=1.0, direction=direction, gender=gender, created_by=uid))
        db.commit()


def test_list_has_mark_counts_and_sakshi_flag(client, auth, video):
    uid = 1
    add_marks(video, uid, [("in", "male"), ("in", "female"), ("in", "unknown"), ("out", "male")])
    rows = client.get(f"/api/projects/{client.get('/api/projects', headers=auth).json()[0]['id']}/videos", headers=auth).json()["items"]
    v = next(r for r in rows if r["id"] == video)
    assert (v["mark_total"], v["mark_in"], v["mark_out"], v["mark_male"], v["mark_female"]) == (4, 3, 1, 2, 1)
    assert v["sakshi_entered"] is False
    client.put(f"/api/videos/{video}/sakshi", json={"in_count": 3}, headers=auth)
    assert client.get(f"/api/videos/{video}", headers=auth).json()["sakshi_entered"] is True
    one = client.get(f"/api/videos/{video}", headers=auth).json()
    assert one["mark_total"] == 4


def test_videos_without_marks_have_zero_counts(client, auth, video):
    one = client.get(f"/api/videos/{video}", headers=auth).json()
    assert (one["mark_total"], one["mark_male"], one["sakshi_entered"]) == (0, 0, False)


def test_upload_records_file_size(client, auth, monkeypatch):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    r = client.post(f"/api/projects/{pid}/videos/upload", files={"file": ("a.mp4", b"x" * 123)}, headers=auth)
    assert r.status_code == 201 and r.json()["file_size"] == 123


def make_recording(tmp_path):
    with SessionLocal() as db:
        from app.models import Project
        pr = Project(name="p", owner_id=1)
        db.add(pr)
        db.flush()
        out = tmp_path / "rec" / "original.mp4"
        out.parent.mkdir(parents=True)
        v = Video(project_id=pr.id, name="cam", source="rtsp", status="connecting", rtsp_url_enc=rtsp.encrypt_url(URL),
                  rtsp_url_masked=rtsp.mask_url(URL), rtsp_minutes=5, file_path=str(out))
        db.add(v)
        db.commit()
        return v.id, out


def run_worker(monkeypatch, tmp_path, result, write=True):
    make_user()
    vid, out = make_recording(tmp_path)

    started = datetime(2026, 11, 10, 12, 0, 40, tzinfo=timezone.utc)

    def fake_run(url, minutes, path, should_stop=None, on_attempt=None, on_connected=None, **kw):
        on_attempt(1, "")
        if write:
            path.write_bytes(b"x" * 2048)
            on_connected(started)  # video arrived: this is the recording's start
        return {"started_at": started if write else None, "ended_at": started + timedelta(seconds=result.get("elapsed", 0)), **result}

    monkeypatch.setattr(rtsp, "run_recording", fake_run)
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 61.5, "fps": 25.0, "vcodec": "h264", "width": 1920, "height": 1080,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})
    monkeypatch.setattr(media, "make_playback", lambda src, dest, info: Path(dest).write_bytes(b"p"))
    monkeypatch.setattr(control, "clear_stop", lambda i: None)
    monkeypatch.setattr(control, "stop_requested", lambda i: False)
    worker.record_rtsp(vid)
    with SessionLocal() as db:
        return db.get(Video, vid)


def test_recording_stores_start_end_size_and_stream_details(monkeypatch, tmp_path):
    v = run_worker(monkeypatch, tmp_path, {"status": "saved", "reason": None, "elapsed": 300})
    assert v.status == "ready"
    assert v.started_at == datetime(2026, 11, 10, 12, 0, 40, tzinfo=timezone.utc)  # when video arrived, not when it was requested
    assert v.ended_at == v.started_at + timedelta(seconds=300)
    assert v.file_size == 2048
    assert (v.width, v.height, v.vcodec, v.duration_s, v.fps) == (1920, 1080, "h264", 61.5, 25.0)


def test_manual_stop_keeps_reason_and_times(monkeypatch, tmp_path):
    v = run_worker(monkeypatch, tmp_path, {"status": "stopped", "reason": "Stopped manually after 61 s", "elapsed": 61})
    assert v.status == "ready" and v.status_reason == "Stopped manually after 61 s"
    assert v.started_at and v.ended_at


def test_partial_recording_is_marked_partial_with_times(monkeypatch, tmp_path):
    v = run_worker(monkeypatch, tmp_path, {"status": "partial", "reason": "Stream dropped after 20 s", "elapsed": 20})
    assert v.status == "partial" and "dropped" in v.status_reason and v.ended_at


def test_failed_attempt_has_no_start_time_but_an_end_time(monkeypatch, tmp_path):
    v = run_worker(monkeypatch, tmp_path, {"status": "failed", "reason": "Could not record the stream.", "elapsed": 2}, write=False)
    assert v.status == "failed" and v.file_size is None
    assert v.started_at is None and v.ended_at is not None  # the camera never connected: no start time, but the attempt has an end


def test_probe_reports_resolution_on_a_real_clip(tmp_path):
    import subprocess
    clip = tmp_path / "c.mp4"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=2",
                    "-c:v", "libx264", str(clip)], check=True)
    info = media.probe(clip)
    assert (info["width"], info["height"], info["vcodec"]) == (320, 180, "h264")
