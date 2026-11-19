import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import redis

from app import control, liveness, media, orphans, rtsp, worker
from app.db import SessionLocal
from app.models import Project, Video
from tests.conftest import make_user

REAL_LIVE_AMONG = liveness.live_among  # captured at import, before the conftest fixture replaces it
URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1"


@pytest.fixture
def fake():
    return control._client  # the in-memory FakeRedis installed by conftest


@pytest.fixture
def pid(client, auth):
    return client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]


def recording(pid, *, age_s=120, file_bytes=0, tmp=None, status="recording", name="rec"):
    with SessionLocal() as db:
        path = None
        v = Video(project_id=pid, name=name, source="rtsp", status=status, rtsp_minutes=30, rtsp_url_enc=rtsp.encrypt_url(URL),
                  rtsp_url_masked=rtsp.mask_url(URL), created_at=datetime.now(timezone.utc) - timedelta(seconds=age_s))
        db.add(v)
        db.flush()
        if file_bytes:
            path = Path(tmp) / f"{v.id}.mp4"
            path.write_bytes(b"x" * file_bytes)
            v.file_path = str(path)
        else:
            v.file_path = str((Path(tmp) if tmp else Path("/nonexistent")) / f"none-{v.id}.mp4")
        db.commit()
        return v.id


def video(vid):
    with SessionLocal() as db:
        v = db.get(Video, vid)
        db.expunge(v)
        return v


# ---------------------------------------------------------------- heartbeat + queue scan
def test_heartbeat_is_set_with_a_ttl_cleared_and_never_raises(fake):
    control.heartbeat(7)
    assert fake.data["sv:rec:7"] == "1" and fake.ttl["sv:rec:7"] == control.HEARTBEAT_TTL_S
    control.heartbeat(8, control.FINISHING_TTL_S)
    assert fake.ttl["sv:rec:8"] == control.FINISHING_TTL_S
    assert control.heartbeats([7, 8, 9]) == {7, 8}
    assert control.heartbeats([]) == set()
    control.clear_heartbeat(7)
    assert control.heartbeats([7, 8]) == {8}
    fake.fail = True
    control.heartbeat(1)  # a Redis hiccup must not interrupt a recording
    control.clear_heartbeat(1)
    with pytest.raises(redis.RedisError):
        control.heartbeats([1])


@pytest.mark.parametrize("args, expected", [
    ([118], 118), ((5,), 5), ("(118,)", 118), ("(118, )", 118), ("118", 118), (" (7,) ", 7),
    ("(1, 2)", None), ("()", None), ([], None), ("(118, False)", 118), ("(118, True)", 118), ("(1, 2)", None), (None, None), ("(abc,)", None), (["x"], None),
])
def test_video_id_from_task_arguments(args, expected):
    assert control.video_id_from_args(args) == expected


def test_queued_recordings_are_found_in_the_broker_queue(fake):
    def msg(task, argsrepr):
        return json.dumps({"body": "x", "headers": {"task": task, "argsrepr": argsrepr}})
    fake.rpush("celery", msg("app.worker.record_rtsp", "(118,)"), msg("app.worker.finalize_recording", "(119,)"),
               msg("app.worker.process_upload", "(120,)"), "not json", json.dumps({"no": "headers"}), msg("app.worker.record_rtsp", "(1, 2)"))
    assert control.queued_video_ids() == {118, 119}  # uploads are not recordings; junk is skipped


# ---------------------------------------------------------------- liveness
class FakeCelery:
    """celery_app.control.inspect(timeout=...).active()/reserved()/scheduled()"""
    def __init__(self, active=None, reserved=None, scheduled=None, boom=False):
        outer = self
        self.boom = boom
        self.replies = {"active": active, "reserved": reserved, "scheduled": scheduled}

        class Insp:
            def __init__(self, timeout): pass
            def active(self): return outer._get("active")
            def reserved(self): return outer._get("reserved")
            def scheduled(self): return outer._get("scheduled")

        class Control:
            def inspect(self, timeout=1.0): return Insp(timeout)
        self.control = Control()

    def _get(self, k):
        if self.boom:
            raise OSError("broker gone")
        return self.replies[k]


def task(vid, name="app.worker.record_rtsp"):
    return {"name": name, "args": [vid]}


def test_live_means_heartbeat_or_queued_or_a_worker_holds_it(fake):
    control.heartbeat(1)
    fake.rpush("celery", json.dumps({"headers": {"task": "app.worker.record_rtsp", "argsrepr": "(2,)"}}))
    cel = FakeCelery(active={"w1": [task(3)]}, reserved={"w1": [task(4)]})
    assert REAL_LIVE_AMONG([1, 2, 3, 4, 6], cel) == {1, 2, 3, 4}  # 6: nothing is recording it
    assert REAL_LIVE_AMONG([6], cel) == set()
    assert REAL_LIVE_AMONG([], cel) == set()


def test_workers_are_only_asked_when_something_is_unaccounted_for(fake):
    control.heartbeat(1)
    control.heartbeat(2)
    asked = []
    cel = FakeCelery(active={"w": [task(9)]})
    original = cel._get
    cel._get = lambda k: (asked.append(k), original(k))[1]
    assert REAL_LIVE_AMONG([1, 2], cel) == {1, 2} and asked == []  # heartbeats answer it: no slow round trip to the workers
    assert REAL_LIVE_AMONG([1, 2, 9], cel) == {1, 2, 9} and sorted(asked) == ["active", "reserved"]


def test_only_recording_tasks_count_and_unrelated_ids_are_ignored(fake):
    cel = FakeCelery(active={"w": [task(9, "app.worker.process_upload"), task(10)]})
    assert REAL_LIVE_AMONG([9, 10, 11], cel) == {10}


def test_no_worker_answering_is_not_an_error_but_a_dead_broker_is_unknown(fake):
    assert REAL_LIVE_AMONG([1], FakeCelery()) == set()  # inspect returns None when no worker replies
    assert REAL_LIVE_AMONG([1], FakeCelery(boom=True)) == set()  # inspect trouble alone proves nothing...
    control.heartbeat(1)
    assert REAL_LIVE_AMONG([1], FakeCelery(boom=True)) == {1}  # ...and the heartbeat still counts
    fake.fail = True
    assert REAL_LIVE_AMONG([1], FakeCelery()) is None  # Redis down: we cannot tell, so never call anything dead


# ---------------------------------------------------------------- Stop and Delete on a recording nothing is recording
def stop(client, auth, vid):
    return client.post(f"/api/videos/{vid}/stop", headers=auth)


def test_stop_on_a_live_recording_only_asks_the_worker(client, auth, pid, fake):
    vid = recording(pid)
    r = stop(client, auth, vid)  # conftest: every recording counts as live
    assert r.status_code == 200 and r.json()["status"] == "recording"
    assert f"sv:stop:{vid}" in fake.data and video(vid).status == "recording"


def test_stop_on_a_dead_recording_without_footage_finishes_it_at_once(client, auth, pid, fake, monkeypatch):
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    vid = recording(pid)  # the situation from the bug report: requested, but no worker ever ran it
    r = stop(client, auth, vid)
    assert r.status_code == 200 and r.json()["status"] == "failed" and "nothing was recorded" in r.json()["status_reason"]
    v = video(vid)
    assert v.status == "failed" and v.ended_at is not None
    assert f"sv:stop:{vid}" not in fake.data  # the stale flag is cleaned up


def test_stop_on_a_dead_recording_with_footage_keeps_it(client, auth, pid, fake, monkeypatch, tmp_path):
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda t, vid: queued.append((t.name, vid)))
    vid = recording(pid, file_bytes=5000, tmp=tmp_path)
    r = stop(client, auth, vid)
    assert r.status_code == 200 and r.json()["status"] == "processing" and "part recorded is kept" in r.json()["status_reason"]
    assert r.json()["file_size"] == 5000 and queued == [("app.worker.finalize_recording", vid)]


def test_stop_does_not_guess_when_it_cannot_tell(client, auth, pid, monkeypatch):
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: None)
    vid = recording(pid)
    assert stop(client, auth, vid).json()["status"] == "recording"


def test_stop_still_rejects_videos_that_are_not_recording(client, auth, pid):
    vid = recording(pid, status="ready")
    assert stop(client, auth, vid).status_code == 409


def test_delete_a_live_recording_is_refused_but_a_dead_one_can_be_removed(client, auth, pid, fake, monkeypatch):
    live = recording(pid, name="live")
    r = client.delete(f"/api/videos/{live}", headers=auth)
    assert r.status_code == 409 and "Stop it first" in r.json()["detail"]
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    fake.data[f"sv:stop:{live}"] = "1"
    assert client.delete(f"/api/videos/{live}", headers=auth).status_code == 204
    assert client.get(f"/api/videos/{live}", headers=auth).status_code == 404
    assert f"sv:stop:{live}" not in fake.data
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: None)
    unknown = recording(pid, name="unknown")
    assert client.delete(f"/api/videos/{unknown}", headers=auth).status_code == 409  # cannot tell: refuse


def test_another_user_cannot_stop_or_delete(client, auth, pid):
    vid = recording(pid)
    _, other = make_user("b@x.com")
    assert stop(client, other, vid).status_code == 404
    assert client.delete(f"/api/videos/{vid}", headers=other).status_code == 404


# ---------------------------------------------------------------- the recorder task
def fake_media(monkeypatch):
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 60.0, "fps": 25.0, "vcodec": "h264", "width": 1920, "height": 1080,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})
    monkeypatch.setattr(media, "make_playback", lambda src, dest, info: Path(dest).write_bytes(b"p"))


def test_stop_pressed_while_still_queued_ends_it_without_starting_ffmpeg(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", tmp=tmp_path)
    called = []
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: called.append(1))
    control.request_stop(vid)
    worker.record_rtsp(vid)
    v = video(vid)
    assert called == [] and v.status == "failed" and v.status_reason == "Cancelled before the camera connected." and v.started_at is None
    assert not fake.data  # heartbeat and stop flag are both gone


def test_a_task_for_a_recording_that_was_already_settled_does_nothing(pid, fake, monkeypatch, tmp_path):
    called = []
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: called.append(1))
    for status in ("failed", "ready", "processing", "partial", "recording"):
        vid = recording(pid, status=status, tmp=tmp_path)
        worker.record_rtsp(vid)
        assert video(vid).status == status
    worker.record_rtsp(99999)  # a video that no longer exists
    assert called == [] and not fake.data


def test_the_recorder_keeps_a_heartbeat_while_recording_and_while_finishing(pid, fake, monkeypatch, tmp_path):
    fake_media(monkeypatch)
    vid = recording(pid, status="connecting", file_bytes=100, tmp=tmp_path)
    seen = {}

    def fake_run(url, minutes, path, should_stop=None, on_tick=None, **kw):
        on_tick()
        seen["during"] = (f"sv:rec:{vid}" in fake.data, fake.ttl.get(f"sv:rec:{vid}"))
        return {"status": "saved", "reason": None, "elapsed": 1800}

    real_make = media.make_playback

    def spy_make(src, dest, info):
        seen["finishing_ttl"] = fake.ttl.get(f"sv:rec:{vid}")
        real_make(src, dest, info)

    monkeypatch.setattr(rtsp, "run_recording", fake_run)
    monkeypatch.setattr(media, "make_playback", spy_make)
    worker.record_rtsp(vid)
    assert seen["during"] == (True, control.HEARTBEAT_TTL_S)
    assert seen["finishing_ttl"] == control.FINISHING_TTL_S  # turning a long recording into a video must not look dead
    assert video(vid).status == "ready" and not fake.data  # heartbeat cleared at the end


def test_the_heartbeat_is_cleared_even_if_the_task_blows_up(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", tmp=tmp_path)
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    worker.record_rtsp(vid)  # run_recording errors are turned into a failed recording
    assert video(vid).status == "failed" and "boom" in video(vid).status_reason and not fake.data


def test_finalize_recording_makes_a_playable_partial_video(pid, fake, monkeypatch, tmp_path):
    fake_media(monkeypatch)
    vid = recording(pid, status="processing", file_bytes=100, tmp=tmp_path)
    with SessionLocal() as db:
        db.get(Video, vid).status_reason = orphans.KEPT
        db.commit()
    worker.finalize_recording(vid)
    v = video(vid)
    assert v.status == "partial" and v.status_reason == orphans.KEPT and v.playback_path and v.duration_s == 60.0
    assert not fake.data
    ready = recording(pid, status="ready")
    worker.finalize_recording(ready)  # only touches rows that are waiting to be finalized
    assert video(ready).status == "ready"


# ---------------------------------------------------------------- cleaning up when a worker starts
def test_reaper_settles_only_recordings_that_nothing_is_recording(pid, monkeypatch, tmp_path):
    dead = recording(pid, age_s=120, name="dead")
    alive = recording(pid, age_s=120, name="alive")
    fresh = recording(pid, age_s=5, name="fresh")
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: {alive} & set(ids))
    assert worker.reap_orphans() == 1
    assert video(dead).status == "failed" and "nothing was recorded" in video(dead).status_reason
    assert video(alive).status == "recording" and video(fresh).status == "recording"  # live one and brand-new one untouched
    assert worker.reap_orphans() == 0  # nothing left to settle


def test_reaper_keeps_footage_and_queues_the_finalize_task(pid, monkeypatch, tmp_path):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda t, vid: queued.append((t.name, vid)))
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    vid = recording(pid, age_s=120, file_bytes=777, tmp=tmp_path)
    assert worker.reap_orphans() == 1
    v = video(vid)
    assert v.status == "processing" and v.file_size == 777 and queued == [("app.worker.finalize_recording", vid)]


def test_reaper_does_nothing_when_it_cannot_tell(pid, monkeypatch):
    vid = recording(pid, age_s=600)
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: None)
    assert worker.reap_orphans() == 0 and video(vid).status == "recording"


def test_reaper_ignores_videos_that_are_not_recording(pid, monkeypatch):
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    ready = recording(pid, age_s=600, status="ready")
    assert worker.reap_orphans() == 0 and video(ready).status == "ready"


def test_settle_orphan_directly(pid, fake, tmp_path):
    vid = recording(pid)
    control.request_stop(vid)
    with SessionLocal() as db:
        orphans.settle_orphan(db, db.get(Video, vid))
    assert video(vid).status == "failed" and f"sv:stop:{vid}" not in fake.data


# ---------------------------------------------------------------- recordings left on "processing"
def stuck(pid, tmp_path, *, ended_ago_s=300, reason=None, with_file=True, name="stuck"):
    vid = recording(pid, status="processing", file_bytes=100 if with_file else 0, tmp=tmp_path, name=name)
    with SessionLocal() as db:
        v = db.get(Video, vid)
        v.ended_at, v.status_reason = datetime.now(timezone.utc) - timedelta(seconds=ended_ago_s), reason
        db.commit()
    return vid


def test_stuck_processing_recordings_are_queued_again(pid, monkeypatch, tmp_path):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda t, vid: queued.append((t.name, vid)))
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    old = stuck(pid, tmp_path, name="old")
    stuck(pid, tmp_path, ended_ago_s=3, name="just-ended")      # may still be on its way to the media queue
    stuck(pid, tmp_path, with_file=False, name="no-footage")      # nothing to convert
    assert worker.requeue_stuck_processing() == 1
    assert queued == [("app.worker.finalize_recording", old)]


def test_processing_recordings_that_are_queued_or_running_are_left_alone(pid, monkeypatch, tmp_path):
    queued = []
    monkeypatch.setattr(worker, "enqueue", lambda t, vid: queued.append(vid))
    busy = stuck(pid, tmp_path, name="busy")
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: {busy} & set(ids))
    assert worker.requeue_stuck_processing() == 0 and queued == []
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: None)  # Redis cannot be asked: never guess
    assert worker.requeue_stuck_processing() == 0 and queued == []


def test_the_media_queue_counts_as_queued(pid, fake, monkeypatch, tmp_path):
    vid = stuck(pid, tmp_path)
    fake.rpush("media", json.dumps({"headers": {"task": "app.worker.finalize_recording", "argsrepr": f"({vid}, False)"}}))
    assert REAL_LIVE_AMONG([vid], worker.celery) == {vid}


def test_a_requeued_recording_is_partial_only_if_it_ended_with_a_reason(pid, fake, monkeypatch, tmp_path):
    fake_media(monkeypatch)
    complete = stuck(pid, tmp_path, reason=None, name="complete")
    cut = stuck(pid, tmp_path, reason="The camera stopped early.", name="cut")
    worker.finalize_recording(complete)
    worker.finalize_recording(cut)
    assert video(complete).status == "ready" and video(cut).status == "partial"


# ---------------------------------------------------------------- the timeline of a recording
def test_each_step_after_requesting_a_recording_is_timed(pid, fake, monkeypatch, tmp_path):
    fake_media(monkeypatch)
    vid = recording(pid, status="connecting", file_bytes=100, tmp=tmp_path)
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: {"status": "saved", "reason": None, "elapsed": 60})
    seen = {}
    real = media.make_playback

    def spy(src, dest, info):
        v = video(vid)  # while converting: queued and started, not finished
        seen["during"] = (v.queued_at is not None, v.converting_at is not None, v.converted_at)
        return real(src, dest, info)

    monkeypatch.setattr(media, "make_playback", spy)
    worker.record_rtsp(vid)
    v = video(vid)
    assert seen["during"] == (True, True, None)
    assert v.status == "ready" and v.playback_size == 1
    assert v.picked_up_at <= v.queued_at <= v.converting_at <= v.converted_at


def test_a_failed_conversion_is_still_timed(pid, fake, monkeypatch, tmp_path):
    monkeypatch.setattr(media, "probe", lambda p: (_ for _ in ()).throw(ValueError("no video")))
    vid = stuck(pid, tmp_path)
    worker.finalize_recording(vid)
    v = video(vid)
    assert v.status == "failed" and v.converting_at is not None and v.converted_at is not None and v.playback_size is None


def test_queueing_again_resets_the_conversion_times(pid, monkeypatch, tmp_path):
    monkeypatch.setattr(worker, "enqueue", lambda t, vid: None)
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())
    vid = stuck(pid, tmp_path)
    with SessionLocal() as db:
        v = db.get(Video, vid)
        v.converting_at = v.converted_at = datetime.now(timezone.utc)
        db.commit()
    assert worker.requeue_stuck_processing() == 1
    v = video(vid)
    assert v.queued_at is not None and v.converting_at is None and v.converted_at is None
