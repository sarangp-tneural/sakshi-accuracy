from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.db import SessionLocal, engine
from app.models import Mark, Project, SakshiResult, Video
from tests.conftest import make_user

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def pid(client, auth):
    return client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]


def add(pid, name, *, status="ready", source="upload", duration=None, days_ago=0.0, marks=(), sakshi=None):
    """marks: iterable of (direction, gender); sakshi: dict of the four fields or None for no row."""
    with SessionLocal() as db:
        v = Video(project_id=pid, name=name, source=source, status=status, duration_s=duration,
                  created_at=NOW - timedelta(days=days_ago))
        db.add(v)
        db.flush()
        for d, g in marks:
            db.add(Mark(video_id=v.id, time_s=1.0, direction=d, gender=g, created_by=1))
        if sakshi is not None:
            db.add(SakshiResult(video_id=v.id, **sakshi))
        db.commit()
        return v.id


def get(client, auth, pid, **params):
    r = client.get(f"/api/projects/{pid}/videos", params=params, headers=auth)
    return r


def names(r):
    return [v["name"] for v in r.json()["items"]]


@pytest.fixture
def seeded(pid):
    add(pid, "alpha.mp4", duration=10, days_ago=0, marks=[("in", "male")] * 3)                                   # counting
    add(pid, "Bravo cam", source="rtsp", status="recording", days_ago=1)                                           # not started
    add(pid, "charlie.mp4", duration=300, days_ago=2, marks=[("in", "male"), ("out", "female")], sakshi={"in_count": 1})  # compared
    add(pid, "delta.mp4", status="processing", days_ago=3)
    add(pid, "echo rtsp", source="rtsp", status="partial", duration=60, days_ago=10, marks=[("out", "unknown")])   # counting
    add(pid, "foxtrot.mp4", status="failed", days_ago=20)
    add(pid, "100%_done.mp4", duration=5, days_ago=30, sakshi={"in_count": None, "out_count": None})              # blank result: not compared
    return pid


def test_default_is_newest_first_with_paging_fields(client, auth, seeded):
    r = get(client, auth, seeded)
    assert r.status_code == 200
    body = r.json()
    assert names(r)[:3] == ["alpha.mp4", "Bravo cam", "charlie.mp4"]
    assert (body["total"], body["page"], body["page_size"]) == (7, 1, 25)


def test_search_is_case_insensitive_and_escapes_wildcards(client, auth, seeded):
    assert names(get(client, auth, seeded, q="BRAVO")) == ["Bravo cam"]
    assert names(get(client, auth, seeded, q="  rtsp ")) == ["echo rtsp"]
    assert names(get(client, auth, seeded, q="100%")) == ["100%_done.mp4"]
    assert names(get(client, auth, seeded, q="%")) == ["100%_done.mp4"]  # a literal percent, not "everything"
    assert names(get(client, auth, seeded, q="_")) == ["100%_done.mp4"]
    assert get(client, auth, seeded, q="nomatch").json()["total"] == 0


def test_status_single_and_multi(client, auth, seeded):
    assert names(get(client, auth, seeded, status="failed")) == ["foxtrot.mp4"]
    r = get(client, auth, seeded, status=["ready", "partial"])
    assert sorted(names(r)) == ["100%_done.mp4", "alpha.mp4", "charlie.mp4", "echo rtsp"]


def test_source_filter(client, auth, seeded):
    assert sorted(names(get(client, auth, seeded, source="rtsp"))) == ["Bravo cam", "echo rtsp"]
    assert get(client, auth, seeded, source="upload").json()["total"] == 5


def test_progress_filters(client, auth, seeded):
    assert sorted(names(get(client, auth, seeded, progress="compared"))) == ["charlie.mp4"]
    assert sorted(names(get(client, auth, seeded, progress="counting"))) == ["alpha.mp4", "echo rtsp"]
    # blank Sakshi form + no marks counts as not started
    assert sorted(names(get(client, auth, seeded, progress="not_started"))) == ["100%_done.mp4", "Bravo cam", "delta.mp4", "foxtrot.mp4"]


def test_date_range(client, auth, seeded):
    frm = (NOW - timedelta(days=2, hours=1)).isoformat()
    to = (NOW - timedelta(days=1, hours=-1)).isoformat()
    assert sorted(names(get(client, auth, seeded, added_from=frm, added_to=to))) == ["Bravo cam", "charlie.mp4"]
    assert get(client, auth, seeded, added_from=(NOW - timedelta(days=15)).isoformat()).json()["total"] == 5
    assert get(client, auth, seeded, added_to=(NOW - timedelta(days=15)).isoformat()).json()["total"] == 2
    naive = (NOW - timedelta(days=15)).replace(tzinfo=None).isoformat()  # no timezone is read as UTC
    assert get(client, auth, seeded, added_from=naive).json()["total"] == 5


def test_filters_combine(client, auth, seeded):
    assert names(get(client, auth, seeded, source="rtsp", status="partial", progress="counting")) == ["echo rtsp"]
    assert get(client, auth, seeded, source="upload", status="partial").json()["total"] == 0
    assert names(get(client, auth, seeded, q="a", status="ready", progress="counting")) == ["alpha.mp4"]


def test_sorts(client, auth, seeded):
    assert names(get(client, auth, seeded, sort="oldest"))[0] == "100%_done.mp4"
    assert names(get(client, auth, seeded, sort="newest"))[0] == "alpha.mp4"
    assert names(get(client, auth, seeded, sort="name")) == ["100%_done.mp4", "alpha.mp4", "Bravo cam", "charlie.mp4", "delta.mp4", "echo rtsp", "foxtrot.mp4"]
    dur = names(get(client, auth, seeded, sort="duration"))
    assert dur[:4] == ["charlie.mp4", "echo rtsp", "alpha.mp4", "100%_done.mp4"]  # longest first
    assert set(dur[4:]) == {"Bravo cam", "delta.mp4", "foxtrot.mp4"}  # no duration: last


def test_pagination(client, auth, pid):
    for i in range(7):
        add(pid, f"v{i}", days_ago=i)
    p1 = get(client, auth, pid, page_size=3).json()
    p2 = get(client, auth, pid, page_size=3, page=2).json()
    p3 = get(client, auth, pid, page_size=3, page=3).json()
    assert [v["name"] for v in p1["items"]] == ["v0", "v1", "v2"]
    assert [v["name"] for v in p2["items"]] == ["v3", "v4", "v5"]
    assert [v["name"] for v in p3["items"]] == ["v6"]
    assert p1["total"] == p2["total"] == p3["total"] == 7
    beyond = get(client, auth, pid, page_size=3, page=9).json()
    assert beyond["items"] == [] and beyond["total"] == 7 and beyond["page"] == 9


def test_status_counts_ignore_status_filter_but_respect_the_others(client, auth, seeded):
    allc = get(client, auth, seeded).json()["status_counts"]
    assert allc == {"all": 7, "ready": 3, "connecting": 0, "recording": 1, "processing": 1, "partial": 1, "failed": 1}
    # picking a status does not change the chips...
    assert get(client, auth, seeded, status="failed").json()["status_counts"] == allc
    # ...but other filters do
    rtsp = get(client, auth, seeded, source="rtsp", status="ready").json()["status_counts"]
    assert rtsp == {"all": 2, "ready": 0, "connecting": 0, "recording": 1, "processing": 0, "partial": 1, "failed": 0}
    q = get(client, auth, seeded, q="alpha").json()
    assert q["status_counts"]["all"] == 1 and q["total"] == 1


def test_busy_ignores_filters(client, auth, seeded):
    assert get(client, auth, seeded, status="failed").json()["busy"] is True  # a recording exists in the project
    with SessionLocal() as db:
        for v in db.query(Video).filter(Video.status.in_(["recording", "processing"])):
            v.status = "ready"
        db.commit()
    assert get(client, auth, seeded).json()["busy"] is False


def test_item_summary_fields(client, auth, seeded):
    items = {v["name"]: v for v in get(client, auth, seeded).json()["items"]}
    c = items["charlie.mp4"]
    assert (c["mark_total"], c["mark_in"], c["mark_out"]) == (2, 1, 1)
    assert c["sakshi_entered"] is True
    e = items["echo rtsp"]
    assert e["mark_total"] == 1
    assert items["100%_done.mp4"]["sakshi_entered"] is False  # saved but blank
    assert items["Bravo cam"]["mark_total"] == 0


@pytest.mark.parametrize("params", [
    {"status": "weird"}, {"source": "ftp"}, {"progress": "done"}, {"sort": "random"}, {"sort": "difference"},
    {"page": 0}, {"page": -1}, {"page_size": 0}, {"page_size": 101}, {"q": "x" * 101},
    {"added_from": "yesterday"}, {"added_to": "2026-99-99"},
])
def test_invalid_params_are_rejected(client, auth, seeded, params):
    assert get(client, auth, seeded, **params).status_code == 422


def test_from_after_to_is_rejected(client, auth, seeded):
    r = get(client, auth, seeded, added_from=NOW.isoformat(), added_to=(NOW - timedelta(days=1)).isoformat())
    assert r.status_code == 422


def test_other_users_project_is_404(client, auth, seeded):
    _, other = make_user("b@x.com")
    assert client.get(f"/api/projects/{seeded}/videos", headers=other).status_code == 404
    assert client.get(f"/api/projects/{seeded}/videos").status_code == 401


def test_query_count_does_not_grow_with_the_number_of_videos(client, auth, pid):
    def statements():
        seen = []
        def on(conn, cursor, statement, *a):
            seen.append(statement)
        event.listen(engine, "before_cursor_execute", on)
        try:
            r = get(client, auth, pid, page_size=100, status=["ready", "partial"], sort="duration")
            assert r.status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", on)
        return len(seen)

    for i in range(3):
        add(pid, f"s{i}", duration=i, marks=[("in", "male")], sakshi={"in_count": 1})
    few = statements()
    for i in range(30):
        add(pid, f"m{i}", duration=i, marks=[("in", "male"), ("out", "female")], sakshi={"in_count": 1})
    many = statements()
    assert few == many and many <= 12, (few, many)
