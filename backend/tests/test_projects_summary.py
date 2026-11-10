from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models import Camera, Mark, Project, SakshiResult, Video
from tests.conftest import make_user

T0 = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


def project(owner_id, name, created=T0):
    with SessionLocal() as db:
        p = Project(name=name, owner_id=owner_id, created_at=created)
        db.add(p)
        db.commit()
        return p.id


def video(pid, name="v", status="ready", duration=None, created=T0, marks=(), sakshi=None):
    with SessionLocal() as db:
        v = Video(project_id=pid, name=name, source="upload", status=status, duration_s=duration, created_at=created)
        db.add(v)
        db.flush()
        for d, g, when in marks:
            db.add(Mark(video_id=v.id, time_s=1.0, direction=d, gender=g, created_by=1, created_at=when))
        if sakshi is not None:
            db.add(SakshiResult(video_id=v.id, **sakshi))
        db.commit()
        return v.id


def camera(pid, name):
    with SessionLocal() as db:
        db.add(Camera(project_id=pid, name=name, rtsp_url_enc="x", rtsp_url_masked="rtsp://***", default_minutes=30))
        db.commit()


def listing(client, auth):
    r = client.get("/api/projects", headers=auth)
    assert r.status_code == 200
    return {p["name"]: p for p in r.json()}, r.json()


@pytest.fixture
def uid(auth):
    return 1


def test_an_empty_project_has_zero_totals_and_its_created_time_as_activity(client, auth, uid):
    project(uid, "empty")
    p = listing(client, auth)[0]["empty"]
    assert (p["video_count"], p["camera_count"], p["mark_total"], p["compared_count"], p["total_duration_s"]) == (0, 0, 0, 0, 0)
    assert (p["recording_count"], p["processing_count"], p["failed_count"]) == (0, 0, 0)
    assert p["last_activity_at"].startswith("2026-11-01T12:00")


def test_totals_for_a_busy_project(client, auth, uid):
    pid = project(uid, "busy")
    later = T0 + timedelta(days=3)
    video(pid, "a", duration=100.5, marks=[("in", "male", later), ("in", "female", T0), ("out", "unknown", T0)], sakshi={"in_count": 2})
    video(pid, "b", status="recording", created=T0 + timedelta(days=1))
    video(pid, "c", status="processing")
    video(pid, "d", status="failed", duration=None)
    video(pid, "e", duration=20, sakshi={"in_count": None, "out_count": None})  # blank result: not compared
    camera(pid, "Entrance"); camera(pid, "Billing")
    p = listing(client, auth)[0]["busy"]
    assert p["video_count"] == 5 and p["camera_count"] == 2
    assert (p["recording_count"], p["processing_count"], p["failed_count"]) == (1, 1, 1)
    assert (p["mark_total"], p["mark_in"], p["mark_out"]) == (3, 2, 1)
    assert p["compared_count"] == 1  # only "a"
    assert p["total_duration_s"] == pytest.approx(120.5)
    assert p["last_activity_at"].startswith("2026-11-04T12:00")  # the newest mark


def test_last_activity_uses_the_newest_video_when_there_are_no_newer_marks(client, auth, uid):
    pid = project(uid, "p")
    video(pid, created=T0 + timedelta(days=2))
    assert listing(client, auth)[0]["p"]["last_activity_at"].startswith("2026-11-03T12:00")


def test_projects_are_listed_most_recently_active_first(client, auth, uid):
    old = project(uid, "old", created=T0)
    new = project(uid, "new", created=T0 + timedelta(days=5))
    mid = project(uid, "mid", created=T0 + timedelta(days=1))
    video(old, marks=[("in", "male", T0 + timedelta(days=9))])  # an old project that was used recently
    names = [p["name"] for p in listing(client, auth)[1]]
    assert names == ["old", "new", "mid"]
    assert new and mid


def test_counts_are_per_project_and_per_user(client, auth, uid):
    a = project(uid, "a")
    b = project(uid, "b")
    video(a, marks=[("in", "male", T0)])
    video(b); video(b)
    other_id, _ = make_user("b@x.com")
    theirs = project(other_id, "theirs")
    video(theirs, marks=[("in", "male", T0)] * 7)
    got, rows = listing(client, auth)
    assert got["a"]["video_count"] == 1 and got["a"]["mark_total"] == 1 and got["b"]["video_count"] == 2 and got["b"]["mark_total"] == 0
    assert "theirs" not in got and len(rows) == 2


def test_a_new_project_comes_back_with_zero_totals(client, auth):
    r = client.post("/api/projects", json={"name": "fresh"}, headers=auth)
    assert r.status_code == 201
    assert (r.json()["video_count"], r.json()["mark_total"], r.json()["camera_count"]) == (0, 0, 0)
    assert r.json()["last_activity_at"] is not None


def test_query_count_does_not_grow_with_the_number_of_projects(client, auth, uid):
    def statements():
        seen = []
        def on(conn, cursor, statement, *a):
            seen.append(statement)
        event.listen(engine, "before_cursor_execute", on)
        try:
            assert client.get("/api/projects", headers=auth).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", on)
        return len(seen)

    for i in range(2):
        pid = project(uid, f"s{i}")
        video(pid, marks=[("in", "male", T0)], sakshi={"in_count": 1}); camera(pid, "c")
    few = statements()
    for i in range(20):
        pid = project(uid, f"m{i}")
        video(pid, marks=[("in", "male", T0), ("out", "female", T0)], sakshi={"in_count": 1}); camera(pid, "c")
    assert statements() == few
