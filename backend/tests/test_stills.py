import numpy as np
import pytest

from app import control, stills, storage, worker
from app.db import SessionLocal
from app.models import Video
from tests.conftest import make_user


def frame(v=100, box=None):
    f = np.full((stills.SIZE, stills.SIZE), v, dtype=np.uint8)
    if box:
        y0, y1, x0, x1 = box
        f[y0:y1, x0:x1] = 255
    return f


def run(frames, fps=stills.SAMPLE_FPS, **kw):
    return stills.select_keyframes(((i / fps, f) for i, f in enumerate(frames)), **kw)


def test_a_still_scene_keeps_the_first_frame_and_one_every_five_seconds():
    kept = run([frame()] * 5 * 12)  # 12 s of nothing
    assert kept == [0.0, 5.0, 10.0]


def test_a_change_is_kept():
    frames = [frame()] * 10 + [frame(box=(10, 50, 10, 50))] * 10
    assert 2.0 in run(frames)  # the frame where the box appears


def test_slow_drift_adds_up_because_frames_are_compared_with_the_last_kept_one():
    frames = [frame(100 + i // 2) for i in range(40)]  # brightness creeping up 1 level per 2 frames
    kept = run(frames, max_gap_s=999)
    assert len(kept) > 1


def test_noise_is_not_a_change():
    rng = np.random.default_rng(1)
    frames = [np.clip(frame() + rng.integers(-2, 3, (stills.SIZE, stills.SIZE)), 0, 255).astype(np.uint8) for _ in range(40)]
    assert run(frames, max_gap_s=999) == [0.0]


def test_roi_filter():
    assert stills.roi_filter(None) == ""
    f = stills.roi_filter({"x": 0.25, "y": 0.5, "w": 0.5, "h": 0.25})
    assert f.startswith("crop=") and f.endswith(",") and "0.25000" in f
    assert stills.roi_filter(None) + "fps=5" in " ".join(stills.build_cmd(__import__("pathlib").Path("a.mp4"), None))


def test_summary_counts_time_saved():
    s = stills.summarize([0.0, 5.0], 1800.0, None)
    assert s["kept_count"] == 2 and s["reviewed_s"] == pytest.approx(0.4) and s["saved_s"] == pytest.approx(1799.6)


@pytest.fixture
def pid(client, auth):
    return client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]


def add(pid, status="ready", removed=False):
    with SessionLocal() as db:
        v = Video(project_id=pid, name="v", source="upload", status=status, duration_s=60.0)
        db.add(v)
        db.flush()
        d = storage.video_dir(v.id)
        (d / "playback.mp4").write_bytes(b"p")
        v.playback_path = str(d / "playback.mp4")
        if removed:
            from app.models import now
            v.video_removed_at = now()
        db.commit()
        return v.id


def test_keyframes_states(client, auth, pid):
    vid = add(pid)
    url = f"/api/videos/{vid}/keyframes"
    assert client.get(url, headers=auth).json() == {"state": "none"}
    control.stills_start(vid)
    assert client.get(url, headers=auth).json() == {"state": "running"}
    control.stills_fail(vid)
    assert client.get(url, headers=auth).json() == {"state": "failed"}
    (storage.video_path(vid) / stills.FILE_NAME).write_text('{"version": 1, "kept": [0.0], "saved_s": 1}')
    r = client.get(url, headers=auth).json()
    assert r["state"] == "ready" and r["kept"] == [0.0]


def test_keyframes_not_ready_or_removed(client, auth, pid):
    assert client.get(f"/api/videos/{add(pid, status='processing')}/keyframes", headers=auth).status_code == 409
    assert client.get(f"/api/videos/{add(pid, removed=True)}/keyframes", headers=auth).status_code == 410


def test_keyframes_are_private(client, auth, pid):
    vid = add(pid)
    other = make_user("b@x.com")[1]
    assert client.get(f"/api/videos/{vid}/keyframes", headers=other).status_code == 404


def turn_on(client, auth, pid):
    assert client.patch(f"/api/projects/{pid}", json={"still_moments": True}, headers=auth).json()["still_moments"] is True


def test_the_project_switch_defaults_off_and_is_private(client, auth, pid):
    assert client.get("/api/projects", headers=auth).json()[0]["still_moments"] is False
    other = make_user("b@x.com")[1]
    assert client.patch(f"/api/projects/{pid}", json={"still_moments": True}, headers=other).status_code == 404
    turn_on(client, auth, pid)
    assert client.get("/api/projects", headers=auth).json()[0]["still_moments"] is True
    assert client.patch(f"/api/projects/{pid}", json={}, headers=auth).json()["still_moments"] is True  # nothing to change


def test_finding_is_refused_while_the_project_has_it_off(client, auth, pid, monkeypatch):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: queued.append(vid))
    vid = add(pid)
    r = client.post(f"/api/videos/{vid}/keyframes", headers=auth)
    assert r.status_code == 409 and "turned off" in r.json()["detail"] and queued == []
    turn_on(client, auth, pid)
    assert client.post(f"/api/videos/{vid}/keyframes", headers=auth).status_code == 202


def test_find_queues_once_and_cancel_stops_it(client, auth, pid, monkeypatch):
    turn_on(client, auth, pid)
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: queued.append((task, vid)))
    vid = add(pid)
    url = f"/api/videos/{vid}/keyframes"
    assert client.post(url, headers=auth).status_code == 202
    assert client.post(url, headers=auth).status_code == 202  # again while running: no second job
    assert queued == [(worker.analyze_stills, vid)]
    assert client.get(url, headers=auth).json()["state"] == "running"
    assert client.post(url + "/cancel", headers=auth).status_code == 204
    assert client.get(url, headers=auth).json()["state"] == "none"


def test_nothing_is_analysed_unless_asked(client, auth, pid, monkeypatch):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: queued.append(task))
    from app.models import Video
    with SessionLocal() as db:
        v = Video(project_id=pid, name="u", source="upload", status="processing")
        db.add(v)
        db.flush()
        d = storage.video_dir(v.id)
        (d / "original.mp4").write_bytes(b"x")
        v.file_path = str(d / "original.mp4")
        db.commit()
        vid = v.id
    monkeypatch.setattr(worker.media, "probe", lambda p: {"duration_s": 5.0, "fps": 25.0})
    monkeypatch.setattr(worker.media, "make_playback", lambda src, dest, info: dest.write_bytes(b"p") or "ready")
    worker.process_upload(vid)
    with SessionLocal() as db:
        assert db.get(Video, vid).status == "ready"
    assert worker.analyze_stills not in queued


def test_a_cancelled_job_does_nothing(client, auth, pid, monkeypatch):
    called = []
    monkeypatch.setattr(stills, "analyze", lambda *a, **k: called.append(1))
    vid = add(pid)  # no running flag = cancelled while it waited in the queue
    worker.analyze_stills(vid)
    assert called == []


def test_analyze_stops_when_told_to(tmp_path, monkeypatch):
    frames = ((i / 5, frame()) for i in range(500))
    monkeypatch.setattr(stills, "read_samples", lambda src, roi: frames)
    out = tmp_path / "k.json"
    asks = []

    def go():
        asks.append(1)
        return len(asks) < 3

    assert stills.analyze(tmp_path / "p.mp4", 100.0, None, out, should_continue=go) is None
    assert not out.exists()
    monkeypatch.setattr(stills, "read_samples", lambda src, roi: ((i / 5, frame()) for i in range(10)))
    assert stills.analyze(tmp_path / "p.mp4", 2.0, None, out)["kept_count"] == 1 and out.exists()


def test_setting_the_focus_area_only_redoes_an_existing_analysis(client, auth, pid, monkeypatch):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: queued.append(vid))
    vid = add(pid)
    f = storage.video_path(vid) / stills.FILE_NAME
    roi = {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.4}
    r = client.put(f"/api/videos/{vid}/roi", json={"roi": roi}, headers=auth)
    assert r.status_code == 200 and r.json()["roi"] == roi
    assert queued == []  # never analysed: just saved
    f.write_text('{"version": 1}')
    client.put(f"/api/videos/{vid}/roi", json={"roi": roi}, headers=auth)
    assert not f.exists() and queued == [vid]  # had a result: dropped and redone
    assert client.put(f"/api/videos/{vid}/roi", json={"roi": {"x": 0.9, "y": 0, "w": 0.5, "h": 0.4}}, headers=auth).status_code == 422
    assert client.put(f"/api/videos/{vid}/roi", json={"roi": None}, headers=auth).json()["roi"] is None


def test_camera_focus_area_is_saved(client, auth, pid):
    cam = client.post(f"/api/projects/{pid}/cameras", json={"name": "c", "url": "rtsp://10.0.0.5/x", "default_minutes": 5}, headers=auth)
    assert cam.status_code == 201, cam.text
    cid = cam.json()["id"]
    roi = {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3}
    assert client.put(f"/api/cameras/{cid}/roi", json={"roi": roi}, headers=auth).json()["roi"] == roi
