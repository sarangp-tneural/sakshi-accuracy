import numpy as np
import pytest

from app import stills, storage, worker
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


def test_keyframes_pending_then_ready(client, auth, pid):
    vid = add(pid)
    r = client.get(f"/api/videos/{vid}/keyframes", headers=auth)
    assert r.status_code == 202
    (storage.video_path(vid) / stills.FILE_NAME).write_text('{"version": 1, "kept": [0.0], "saved_s": 1}')
    r = client.get(f"/api/videos/{vid}/keyframes", headers=auth)
    assert r.status_code == 200 and r.json()["kept"] == [0.0]


def test_keyframes_states(client, auth, pid):
    assert client.get(f"/api/videos/{add(pid, status='processing')}/keyframes", headers=auth).status_code == 409
    assert client.get(f"/api/videos/{add(pid, removed=True)}/keyframes", headers=auth).status_code == 410


def test_keyframes_are_private(client, auth, pid):
    vid = add(pid)
    other = make_user("b@x.com")[1]
    assert client.get(f"/api/videos/{vid}/keyframes", headers=other).status_code == 404


def test_redo_queues_the_analysis(client, auth, pid, monkeypatch):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: queued.append((task, vid)))
    vid = add(pid)
    assert client.post(f"/api/videos/{vid}/keyframes", headers=auth).status_code == 202
    assert queued == [(worker.analyze_stills, vid)]


def test_setting_the_door_area_drops_the_old_result_and_redoes_it(client, auth, pid, monkeypatch):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: queued.append(vid))
    vid = add(pid)
    f = storage.video_path(vid) / stills.FILE_NAME
    f.write_text('{"version": 1}')
    roi = {"x": 0.1, "y": 0.2, "w": 0.5, "h": 0.4}
    r = client.put(f"/api/videos/{vid}/roi", json={"roi": roi}, headers=auth)
    assert r.status_code == 200 and r.json()["roi"] == roi
    assert not f.exists() and queued == [vid]
    assert client.put(f"/api/videos/{vid}/roi", json={"roi": {"x": 0.9, "y": 0, "w": 0.5, "h": 0.4}}, headers=auth).status_code == 422
    assert client.put(f"/api/videos/{vid}/roi", json={"roi": None}, headers=auth).json()["roi"] is None


def test_camera_door_area_is_copied_to_new_recordings(client, auth, pid):
    cam = client.post(f"/api/projects/{pid}/cameras", json={"name": "c", "url": "rtsp://10.0.0.5/x", "default_minutes": 5}, headers=auth)
    assert cam.status_code == 201, cam.text
    cid = cam.json()["id"]
    roi = {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3}
    assert client.put(f"/api/cameras/{cid}/roi", json={"roi": roi}, headers=auth).json()["roi"] == roi
