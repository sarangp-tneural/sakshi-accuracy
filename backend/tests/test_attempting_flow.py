from datetime import timedelta

import pytest

from app import control, liveness, media, rtsp, worker
from app.config import settings
from app.db import SessionLocal
from app.models import Video
from tests.fakes import DEAD, T0, Clock, FakeProc, healthy
from tests.test_orphans import fake, pid, recording, video  # noqa: F401  (fixtures and helpers)

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1"


@pytest.fixture(autouse=True)
def timing(monkeypatch):
    monkeypatch.setattr(settings, "rtsp_min_footage_bytes", 1000)
    monkeypatch.setattr(settings, "rtsp_attempt_window_s", 300)
    monkeypatch.setattr(settings, "rtsp_attempt_retry_s", 10)
    monkeypatch.setattr(settings, "rtsp_attempt_try_s", 25)


def stub_media(monkeypatch):
    from pathlib import Path
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 60.0, "fps": 25.0, "vcodec": "h264", "width": 1920, "height": 1080,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})
    monkeypatch.setattr(media, "make_playback", lambda src, dest, info: (Path(dest).write_bytes(b"p"), "ready")[1])


def simulate(monkeypatch, vid, plans, press_stop_at=None):
    """Run the REAL recorder loop inside the real worker task, with a simulated clock and camera. Returns the list of row snapshots."""
    real, snaps = rtsp.run_recording, []

    def wrapped(url, minutes, path, **kw):
        c, procs = Clock(), []

        def tick():
            kw["on_tick"]()
            v = video(vid)
            snaps.append((c.t, v.status, v.status_reason, v.started_at))
            if press_stop_at is not None and c.t >= press_stop_at:
                control.request_stop(vid)

        def popen(cmd, **k):
            procs.append(FakeProc(c, path, **plans[min(len(procs), len(plans) - 1)]))
            return procs[-1]

        return real(url, minutes, path, clock=c, sleep=c.sleep, wall=c.wall, popen=popen,
                    should_stop=kw["should_stop"], on_tick=tick, on_attempt=kw["on_attempt"], on_connected=kw["on_connected"])

    monkeypatch.setattr(rtsp, "run_recording", wrapped)
    return snaps


# ------------------------------------------------------------------ the whole journey through the worker
def test_requested_attempting_recording_saving_ready(pid, fake, monkeypatch, tmp_path):
    stub_media(monkeypatch)
    vid = recording(pid, status="connecting", tmp=tmp_path)
    with SessionLocal() as db:
        db.get(Video, vid).rtsp_minutes = 1  # a one-minute recording
        db.commit()
    snaps = simulate(monkeypatch, vid, [DEAD, DEAD, healthy(1)])
    worker.record_rtsp(vid)
    # while attempting: status connecting, no start time, and the note says which try and why the last failed
    first = next(s for s in snaps if s[0] == 0)
    assert first[1] == "connecting" and first[3] is None and first[2] == "Attempt 1 · connecting…"
    mid = next(s for s in snaps if s[0] == 25)
    assert mid[1] == "connecting" and mid[2].startswith("Attempt 2 · Could not reach the camera") and mid[3] is None
    waiting = next(s for s in snaps if s[0] == 39)  # between tries the note keeps the last failure
    assert waiting[1] == "connecting" and waiting[2].startswith("Attempt 2 · Could not reach the camera")
    # from the moment video arrives: recording, with that moment as the start
    rec = next(s for s in snaps if s[0] == 41)
    assert rec[1] == "recording" and rec[2] is None and rec[3] == T0 + timedelta(seconds=40)
    v = video(vid)
    assert v.status == "ready" and v.started_at == T0 + timedelta(seconds=40) and v.ended_at == T0 + timedelta(seconds=100)
    assert not fake.data


def test_never_connecting_ends_failed_with_no_start_time(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", tmp=tmp_path)
    simulate(monkeypatch, vid, [DEAD])
    worker.record_rtsp(vid)
    v = video(vid)
    assert v.status == "failed" and v.started_at is None and v.ended_at == T0 + timedelta(seconds=300)
    assert "did not come online within 5 min (15 attempts)" in v.status_reason and "Could not reach the camera" in v.status_reason
    assert v.file_size is None and not fake.data


def test_stop_while_attempting_cancels_the_attempt(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", tmp=tmp_path)
    simulate(monkeypatch, vid, [DEAD], press_stop_at=5)
    worker.record_rtsp(vid)
    v = video(vid)
    assert v.status == "failed" and v.status_reason == "Cancelled before the camera connected." and v.started_at is None and not fake.data


def test_feed_lost_mid_recording_ends_partial_at_the_last_data_time(pid, fake, monkeypatch, tmp_path):
    stub_media(monkeypatch)
    vid = recording(pid, status="connecting", tmp=tmp_path)
    simulate(monkeypatch, vid, [dict(data_for=30, exits_after=32, rc=1, err="Connection reset by peer")])
    with SessionLocal() as db:
        db.get(Video, vid).rtsp_minutes = 5
        db.commit()
    worker.record_rtsp(vid)
    v = video(vid)
    assert v.status == "partial" and v.started_at == T0 and v.ended_at == T0 + timedelta(seconds=29)
    assert "stopped sending video at" in v.status_reason


# ------------------------------------------------------------------ stop and delete on an attempt
def test_stop_on_a_live_attempt_only_asks_the_worker(client, auth, pid, fake):
    vid = recording(pid, status="connecting")
    r = client.post(f"/api/videos/{vid}/stop", headers=auth)
    assert r.status_code == 200 and r.json()["status"] == "connecting" and f"sv:stop:{vid}" in fake.data


def test_stop_on_an_attempt_nothing_is_working_on_cancels_it_at_once(client, auth, pid, fake, monkeypatch):
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    vid = recording(pid, status="connecting")
    r = client.post(f"/api/videos/{vid}/stop", headers=auth)
    assert r.json()["status"] == "failed" and "nothing was recorded" in r.json()["status_reason"]


def test_delete_an_attempt_is_refused_while_live_and_allowed_when_dead(client, auth, pid, monkeypatch):
    vid = recording(pid, status="connecting")
    assert client.delete(f"/api/videos/{vid}", headers=auth).status_code == 409
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    assert client.delete(f"/api/videos/{vid}", headers=auth).status_code == 204


def test_the_reaper_settles_an_attempt_nothing_is_working_on(pid, monkeypatch):
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    vid = recording(pid, status="connecting", age_s=300)
    assert worker.reap_orphans() == 1 and video(vid).status == "failed"


# ------------------------------------------------------------------ lists, cameras, projects
def test_the_video_list_filters_counts_and_busy_include_attempting(client, auth, pid):
    a = recording(pid, status="connecting", name="attempting")
    recording(pid, status="recording", name="recording")
    recording(pid, status="ready", name="done")
    body = client.get(f"/api/projects/{pid}/videos", params={"status": "connecting"}, headers=auth).json()
    assert [v["name"] for v in body["items"]] == ["attempting"] and body["status_counts"]["connecting"] == 1 and body["status_counts"]["recording"] == 1
    assert body["busy"] is True
    with SessionLocal() as db:
        db.get(Video, a).status = "ready"
        for v in db.query(Video).filter(Video.status == "recording"):
            v.status = "ready"
        db.commit()
    assert client.get(f"/api/projects/{pid}/videos", headers=auth).json()["busy"] is False
    only_attempt = recording(pid, status="connecting", name="only")
    assert client.get(f"/api/projects/{pid}/videos", headers=auth).json()["busy"] is True and only_attempt


def test_a_camera_card_can_tell_attempting_from_recording(client, auth, pid, monkeypatch):
    cam = client.post(f"/api/projects/{pid}/cameras", json={"name": "Entrance", "url": URL, "default_minutes": 5}, headers=auth).json()["id"]
    monkeypatch.setattr(worker, "enqueue", lambda t, v: None)
    r = client.post(f"/api/cameras/{cam}/record", headers=auth)
    assert r.status_code == 201 and r.json()["status"] == "connecting"
    row = client.get(f"/api/projects/{pid}/cameras", headers=auth).json()[0]
    assert row["recording_status"] == "connecting" and row["recording_video_id"] == r.json()["id"] and row["recording_started_at"] is None
    assert row["recording_note"] is None  # no try has been made yet
    with SessionLocal() as db:
        db.get(Video, r.json()["id"]).status_reason = "Attempt 2 · The camera refused the connection."
        db.commit()
    assert client.get(f"/api/projects/{pid}/cameras", headers=auth).json()[0]["recording_note"].startswith("Attempt 2")
    assert client.post(f"/api/cameras/{cam}/record", headers=auth).status_code == 409  # an attempt in progress blocks a second start
    with SessionLocal() as db:
        v = db.get(Video, r.json()["id"])
        v.status, v.started_at = "recording", T0
        db.commit()
    row = client.get(f"/api/projects/{pid}/cameras", headers=auth).json()[0]
    assert row["recording_status"] == "recording" and row["recording_started_at"] is not None
    assert client.post(f"/api/cameras/{cam}/record", headers=auth).status_code == 409
    with SessionLocal() as db:
        db.get(Video, r.json()["id"]).status = "processing"
        db.commit()
    row = client.get(f"/api/projects/{pid}/cameras", headers=auth).json()[0]
    assert row["recording_status"] is None and row["recording_video_id"] is None  # saving: the camera can be started again
    assert client.post(f"/api/cameras/{cam}/record", headers=auth).status_code == 201


def test_a_project_counts_attempting_separately_from_recording(client, auth, pid):
    recording(pid, status="connecting")
    recording(pid, status="connecting")
    recording(pid, status="recording")
    p = next(x for x in client.get("/api/projects", headers=auth).json() if x["id"] == pid)
    assert (p["connecting_count"], p["recording_count"]) == (2, 1)


def test_new_recordings_start_as_attempting(client, auth, pid, monkeypatch):
    monkeypatch.setattr(worker, "enqueue", lambda t, v: None)
    r = client.post(f"/api/projects/{pid}/videos/rtsp", json={"url": URL, "minutes": 5}, headers=auth)
    assert r.status_code == 201 and r.json()["status"] == "connecting" and r.json()["started_at"] is None
