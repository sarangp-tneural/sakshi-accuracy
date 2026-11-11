import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app import orphans, storage
from app.config import settings
from app.db import SessionLocal
from app.models import Mark, SakshiResult, Video
from app.routers import videos as videos_router
from tests.conftest import make_user

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def pid(client, auth):
    return client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]


def add(pid, name="v", status="ready", orig=3000, play=2000, duration=60.0, with_files=True, marks=()):
    """A video row, with real files on disk in the video's folder."""
    with SessionLocal() as db:
        v = Video(project_id=pid, name=name, source="rtsp", status=status, duration_s=duration, fps=25.0, width=1920, height=1080, vcodec="h264",
                  file_size=orig, rtsp_minutes=5, rtsp_url_masked="rtsp://***:***@10.0.0.5/x", status_reason="note")
        db.add(v)
        db.flush()
        if with_files:
            d = storage.video_dir(v.id)
            (d / "original.mp4").write_bytes(b"o" * orig)
            (d / "playback.mp4").write_bytes(b"p" * play)
            v.file_path, v.playback_path = str(d / "original.mp4"), str(d / "playback.mp4")
        for t, direction, gender in marks:
            db.add(Mark(video_id=v.id, time_s=t, direction=direction, gender=gender, created_by=1))
        db.commit()
        return v.id


def remove(client, auth, vid):
    return client.delete(f"/api/videos/{vid}/file", headers=auth)


def row(vid):
    with SessionLocal() as db:
        v = db.get(Video, vid)
        db.expunge(v)
        return v


# ------------------------------------------------------------------ the action
def test_it_deletes_the_files_and_frees_the_space_but_nothing_else(client, auth, pid):
    vid = add(pid, marks=[(1, "in", "male"), (2, "out", "female"), (3, "in", "unknown")])
    with SessionLocal() as db:
        db.add(SakshiResult(video_id=vid, in_count=2, out_count=1))
        db.commit()
    before_csv = client.get(f"/api/videos/{vid}/export.csv", headers=auth).text
    folder = storage.video_path(vid)
    assert folder.exists()
    r = remove(client, auth, vid)
    assert r.status_code == 200
    body = r.json()
    assert body["freed_bytes"] == 5000 and body["video"]["video_removed_at"] is not None and body["video"]["disk_bytes"] is None
    assert not folder.exists()  # the files are really gone from disk
    v = row(vid)
    assert v.file_path is None and v.playback_path is None and v.video_removed_at is not None
    # ...and everything else is exactly as it was
    assert (v.status, v.status_reason, v.duration_s, v.fps, v.width, v.height, v.vcodec, v.file_size) == ("ready", "note", 60.0, 25.0, 1920, 1080, "h264", 3000)
    marks = client.get(f"/api/videos/{vid}/marks", headers=auth).json()
    assert [(m["direction"], m["gender"]) for m in marks] == [("in", "male"), ("out", "female"), ("in", "unknown")]
    cmp = client.get(f"/api/videos/{vid}/comparison", headers=auth).json()
    assert cmp["in"]["manual"] == 2 and cmp["in"]["sakshi"] == 2 and cmp["out"]["sakshi"] == 1
    assert client.get(f"/api/videos/{vid}/export.csv", headers=auth).text == before_csv
    assert client.get(f"/api/videos/{vid}/export.xlsx", headers=auth).status_code == 200
    one = client.get(f"/api/videos/{vid}", headers=auth).json()
    assert (one["mark_total"], one["mark_in"], one["sakshi_entered"], one["rtsp_url_masked"]) == (3, 2, True, "rtsp://***:***@10.0.0.5/x")


@pytest.mark.parametrize("status", ["ready", "partial", "failed"])
def test_finished_videos_can_have_their_file_removed(client, auth, pid, status):
    assert remove(client, auth, add(pid, status=status)).status_code == 200


@pytest.mark.parametrize("status", ["connecting", "recording", "processing"])
def test_a_video_still_being_recorded_or_saved_is_refused(client, auth, pid, status):
    vid = add(pid, status=status)
    r = remove(client, auth, vid)
    assert r.status_code == 409 and storage.video_path(vid).exists() and row(vid).video_removed_at is None


def test_removing_twice_is_refused(client, auth, pid):
    vid = add(pid)
    assert remove(client, auth, vid).status_code == 200
    r = remove(client, auth, vid)
    assert r.status_code == 409 and "already deleted" in r.json()["detail"]


def test_a_row_with_no_files_can_still_be_marked_removed(client, auth, pid):
    vid = add(pid, with_files=False)
    r = remove(client, auth, vid)
    assert r.status_code == 200 and r.json()["freed_bytes"] == 0 and row(vid).video_removed_at is not None


def test_other_users_and_anonymous_are_refused(client, auth, pid):
    vid = add(pid)
    _, other = make_user("b@x.com")
    assert remove(client, other, vid).status_code == 404 and storage.video_path(vid).exists()
    assert client.delete(f"/api/videos/{vid}/file").status_code == 401


def test_if_the_files_cannot_be_deleted_the_database_is_left_alone(client, auth, pid, monkeypatch):
    vid = add(pid)
    monkeypatch.setattr(videos_router.shutil, "rmtree", lambda p: (_ for _ in ()).throw(PermissionError(13, "Permission denied")))
    r = remove(client, auth, vid)
    assert r.status_code == 500 and "Permission denied" in r.json()["detail"]
    v = row(vid)
    assert v.video_removed_at is None and v.file_path and v.playback_path  # still says the video exists, so a retry can finish
    monkeypatch.undo()
    assert remove(client, auth, vid).status_code == 200


# ------------------------------------------------------------------ what a removed video allows
def test_the_stream_says_gone_after_removal_and_works_before(client, auth, pid):
    vid = add(pid, play=500)
    ok = client.get(f"/api/videos/{vid}/stream", headers={**auth, "Range": "bytes=0-99"})
    assert ok.status_code == 206 and len(ok.content) == 100
    remove(client, auth, vid)
    r = client.get(f"/api/videos/{vid}/stream", headers=auth)
    assert r.status_code == 410 and "deleted" in r.json()["detail"]


def test_new_marks_are_refused_but_existing_ones_stay_editable(client, auth, pid):
    vid = add(pid, marks=[(5, "in", "male")])
    mid = client.get(f"/api/videos/{vid}/marks", headers=auth).json()[0]["id"]
    remove(client, auth, vid)
    r = client.post(f"/api/videos/{vid}/marks", json={"time_s": 1, "direction": "in", "gender": "male"}, headers=auth)
    assert r.status_code == 409 and "deleted" in r.json()["detail"]
    assert client.patch(f"/api/marks/{mid}", json={"direction": "out", "gender": "female", "time_s": 6.5}, headers=auth).status_code == 200
    assert client.put(f"/api/marks/{mid}/point", json={"x": 0.4, "y": 0.6}, headers=auth).status_code == 200
    assert client.put(f"/api/videos/{vid}/sakshi", json={"in_count": 3}, headers=auth).status_code == 200
    assert client.get(f"/api/videos/{vid}/comparison", headers=auth).json()["out"]["manual"] == 1
    assert client.delete(f"/api/marks/{mid}", headers=auth).status_code == 204


def test_a_removed_video_can_still_be_deleted_completely(client, auth, pid):
    vid = add(pid, marks=[(1, "in", "male")])
    remove(client, auth, vid)
    assert client.delete(f"/api/videos/{vid}", headers=auth).status_code == 204
    assert client.get(f"/api/videos/{vid}", headers=auth).status_code == 404
    gone = add(pid, name="x")
    shutil.rmtree(storage.video_path(gone))  # the folder vanished by itself
    assert client.delete(f"/api/videos/{gone}", headers=auth).status_code == 204


# ------------------------------------------------------------------ the list
def test_the_list_reports_removal_and_what_each_video_takes_on_disk(client, auth, pid):
    a = add(pid, "a", orig=4000, play=1000)
    b = add(pid, "b", orig=100, play=50)
    items = {v["name"]: v for v in client.get(f"/api/projects/{pid}/videos", headers=auth).json()["items"]}
    assert items["a"]["disk_bytes"] == 5000 and items["b"]["disk_bytes"] == 150 and items["a"]["video_removed_at"] is None
    remove(client, auth, a)
    items = {v["name"]: v for v in client.get(f"/api/projects/{pid}/videos", headers=auth).json()["items"]}
    assert items["a"]["disk_bytes"] is None and items["a"]["video_removed_at"] is not None and items["b"]["disk_bytes"] == 150
    assert b


def test_sort_by_size_puts_the_biggest_first_and_removed_or_unknown_last(client, auth, pid):
    add(pid, "small", orig=100)
    add(pid, "huge", orig=9000)
    gone = add(pid, "was-biggest", orig=99999)
    add(pid, "unknown", orig=None, with_files=False)
    remove(client, auth, gone)
    names = [v["name"] for v in client.get(f"/api/projects/{pid}/videos", params={"sort": "size"}, headers=auth).json()["items"]]
    assert names == ["huge", "small", "was-biggest", "unknown"] or names[:2] == ["huge", "small"]
    assert names.index("was-biggest") > names.index("small")  # a removed video takes no space, whatever it once weighed


def test_filter_by_whether_the_video_is_still_there(client, auth, pid):
    keep = add(pid, "keep")
    gone = add(pid, "gone")
    remove(client, auth, gone)
    q = lambda v: client.get(f"/api/projects/{pid}/videos", params={"video": v}, headers=auth).json()
    assert [x["name"] for x in q("available")["items"]] == ["keep"] and q("available")["total"] == 1
    assert [x["name"] for x in q("removed")["items"]] == ["gone"]
    assert q("removed")["status_counts"]["all"] == 1  # the chips count what the filter leaves
    assert client.get(f"/api/projects/{pid}/videos", params={"video": "maybe"}, headers=auth).status_code == 422
    assert keep


def test_unknown_sort_values_are_still_rejected(client, auth, pid):
    assert client.get(f"/api/projects/{pid}/videos", params={"sort": "weight"}, headers=auth).status_code == 422


# ------------------------------------------------------------------ scripts and helpers must not mistake "no path" for a file
def test_a_missing_path_is_not_the_current_directory(pid):
    vid = add(pid, status="processing", with_files=False)
    with SessionLocal() as db:
        v = db.get(Video, vid)
        v.status, v.file_path = "connecting", None
        db.commit()
        orphans.settle_orphan(db, v)  # Path("") is "." and exists: this must not count as footage
    assert row(vid).status == "failed"


@pytest.mark.parametrize("script", ["reprocess_playback.py", "backfill_video_details.py"])
def test_the_maintenance_scripts_skip_rows_whose_file_was_removed(client, auth, pid, script):
    vid = add(pid, "removed-one")
    remove(client, auth, vid)
    args = [sys.executable, str(ROOT / "scripts" / script), "--all", "--dry-run"] if script.startswith("reprocess") else [sys.executable, str(ROOT / "scripts" / script)]
    out = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-400:]
    assert "Traceback" not in out.stderr and "would update 0" in out.stdout or "missing" in out.stdout  # skipped, not crashed
