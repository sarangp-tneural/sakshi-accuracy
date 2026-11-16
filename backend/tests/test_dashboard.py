from datetime import datetime, timedelta, timezone

import pytest

from app import control, relay, storage
from app.config import settings
from app.db import SessionLocal
from app.models import Camera, Video
from tests.conftest import make_user


def project(client, auth, name="p"):
    return client.post("/api/projects", json={"name": name}, headers=auth).json()["id"]


def video(pid, name="v", *, camera=None, days_ago=0, status="ready"):
    with SessionLocal() as db:
        v = Video(project_id=pid, name=name, source="upload", status=status, duration_s=100, camera_id=camera,
                  created_at=datetime.now(timezone.utc) - timedelta(days=days_ago))
        db.add(v)
        db.commit()
        return v.id


def camera(pid, name="Cam"):
    with SessionLocal() as db:
        c = Camera(project_id=pid, name=name, rtsp_url_enc="x", rtsp_url_masked="rtsp://***")
        db.add(c)
        db.commit()
        return c.id


def types(client, auth, pid):
    return {t["label"]: t["id"] for t in client.get(f"/api/projects/{pid}/marking-types", headers=auth).json()}


def count(client, auth, vid, pid, manual_in, sakshi_in, tp=None):
    """manual_in marks of 'Male IN'; Sakshi says sakshi_in for it (and 0 for the other markings)."""
    ts = types(client, auth, pid)
    for i in range(manual_in):
        client.post(f"/api/videos/{vid}/marks", json={"time_s": 1 + i * 0.1, "marking_type_id": ts["Male IN"]}, headers=auth)
    if sakshi_in is not None:
        counts = {i: 0 for i in ts.values()}
        counts[ts["Male IN"]] = sakshi_in
        client.put(f"/api/videos/{vid}/sakshi", json={"counts": counts}, headers=auth)
    if tp is not None:
        r = client.put(f"/api/videos/{vid}/evaluation", json={"tp": tp}, headers=auth)
        assert r.status_code == 200, r.text


def dash(client, auth, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    r = client.get(f"/api/dashboard?{q}", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def test_totals_equal_the_project_report(client, auth):
    pid = project(client, auth)
    a, b = video(pid, "a"), video(pid, "b")
    count(client, auth, a, pid, 10, 12, 9)
    count(client, auth, b, pid, 20, 18, 15)
    d = dash(client, auth)
    rep = client.get(f"/api/projects/{pid}/evaluation", headers=auth).json()["total"]
    m = d["cards"]["metrics"]
    assert (m["actual"], m["system"], m["tp"], m["precision"], m["recall"]) == (30, 30, 24, 80.0, 80.0)
    assert (rep["actual"], rep["system"], rep["tp"], rep["precision"], rep["recall"]) == (30, 30, 24, 80.0, 80.0)
    assert d["cards"]["added"] == 2 and d["cards"]["tp"] == 2 and d["cards"]["count_off_pct"] == 0.0
    assert {v["name"] for v in d["videos"]} == {"a", "b"}


def test_filters_by_project_and_period(client, auth):
    p1, p2 = project(client, auth, "one"), project(client, auth, "two")
    v_new, v_old, v_other = video(p1, "new"), video(p1, "old", days_ago=40), video(p2, "other")
    for vid, pid in ((v_new, p1), (v_old, p1), (v_other, p2)):
        count(client, auth, vid, pid, 2, 2, 2)
    assert {v["name"] for v in dash(client, auth, days=0)["videos"]} == {"new", "old", "other"}
    assert {v["name"] for v in dash(client, auth, days=30)["videos"]} == {"new", "other"}
    assert {v["name"] for v in dash(client, auth, days=0, project_id=p1)["videos"]} == {"new", "old"}
    assert [p["name"] for p in dash(client, auth)["projects"]] == ["one", "two"]
    _, other = make_user("b@x.com")
    assert client.get(f"/api/dashboard?project_id={p1}", headers=other).status_code == 404


def test_group_by_camera_and_project(client, auth):
    p1, p2 = project(client, auth, "Borivali"), project(client, auth, "Mira Road")
    cam = camera(p1, "Door")
    a, b, c = video(p1, "a", camera=cam), video(p1, "b"), video(p2, "c")
    count(client, auth, a, p1, 10, 10, 10)
    count(client, auth, b, p1, 10, 20, 10)
    count(client, auth, c, p2, 10, 10, 5)
    by_cam = {g["label"]: g for g in dash(client, auth, group="camera")["groups"]}
    assert set(by_cam) == {"Door", "No camera"} and by_cam["Door"]["metrics"]["precision"] == 100.0
    assert by_cam["No camera"]["videos"] == 2 and by_cam["No camera"]["metrics"]["tp"] == 15
    by_project = {g["label"]: g for g in dash(client, auth, group="project")["groups"]}
    assert by_project["Borivali"]["metrics"]["system"] == 30 and by_project["Mira Road"]["metrics"]["recall"] == 50.0


def test_cameras_with_the_same_name_are_told_apart(client, auth):
    p1, p2 = project(client, auth, "Borivali"), project(client, auth, "Mira Road")
    c1, c2 = camera(p1, "Entrance"), camera(p2, "Entrance")
    count(client, auth, video(p1, "a", camera=c1), p1, 2, 2, 2)
    count(client, auth, video(p2, "b", camera=c2), p2, 2, 2, 2)
    assert {g["label"] for g in dash(client, auth, group="camera")["groups"]} == {"Entrance · Borivali", "Entrance · Mira Road"}


def test_trend_by_day(client, auth):
    pid = project(client, auth)
    count(client, auth, video(pid, "today"), pid, 4, 4, 4)
    count(client, auth, video(pid, "earlier", days_ago=2), pid, 10, 10, 5)
    t = dash(client, auth)["trend"]
    assert [x["videos"] for x in t] == [1, 1] and t[0]["recall"] == 50.0 and t[1]["recall"] == 100.0 and t[0]["date"] < t[1]["date"]


def texts(d, sev=None):
    return [f["text"] for f in d["findings"] if sev is None or f["severity"] == sev]


def test_findings_flag_the_right_videos(client, auth):
    pid = project(client, auth)
    over = video(pid, "Pittappillil")
    count(client, auth, over, pid, 34, 55, 27)  # over by 21 (62%), precision 49%, recall 79%
    good = video(pid, "Borivali")
    count(client, auth, good, pid, 20, 20, 20)
    d = dash(client, auth)
    bad = texts(d, "bad")
    assert any("over-counted by +21" in t and "Pittappillil" in t for t in bad)
    assert any("Low precision" in t and "Pittappillil" in t for t in bad)
    assert any("Low recall" in t and "Pittappillil" in t for t in texts(d, "warn"))
    assert not any("Borivali" in t for t in texts(d, "bad") + texts(d, "warn"))  # accurate video: nothing flagged
    assert d["findings"][0]["link"] == f"/videos/{over}"
    assert [f["severity"] for f in d["findings"]] == sorted((f["severity"] for f in d["findings"]), key=["bad", "warn", "info"].index)


def test_findings_for_missing_data(client, auth):
    pid = project(client, auth)
    assert any("No videos" in t for t in texts(dash(client, auth)))
    no_tp, no_sakshi = video(pid, "a"), video(pid, "b")
    count(client, auth, no_tp, pid, 3, 3)
    count(client, auth, no_sakshi, pid, 2, None)
    t = texts(dash(client, auth))
    assert any("1 video has a Sakshi count but no TP" in x for x in t)
    assert any("1 video has marks but no Sakshi result" in x for x in t)


def test_numbers_that_no_longer_add_up_are_flagged(client, auth):
    pid = project(client, auth)
    v = video(pid, "v")
    count(client, auth, v, pid, 3, 3, 3)
    client.delete(f"/api/videos/{v}/marks/last", headers=auth)  # TP 3 is now more than the actual count 2
    assert any("no longer add up" in x for x in texts(dash(client, auth), "bad"))


def test_marking_results_and_a_greeting(client, auth):
    pid = project(client, auth)
    v = video(pid, "v")
    g = client.post(f"/api/projects/{pid}/marking-types", json={"label": "Greeting", "key_code": "KeyB"}, headers=auth).json()["id"]
    for i in range(4):
        client.post(f"/api/videos/{v}/marks", json={"time_s": 1 + i, "marking_type_id": g}, headers=auth)
    ts = types(client, auth, pid)
    client.put(f"/api/videos/{v}/sakshi", json={"counts": {i: (5 if i == g else 0) for i in ts.values()}}, headers=auth)
    client.put(f"/api/videos/{v}/evaluation", json={"type_tp": {g: 3}}, headers=auth)
    d = dash(client, auth)
    gr = next(m for m in d["markings"] if m["label"] == "Greeting")
    assert gr["marked"] == 4 and gr["metrics"]["precision"] == 60.0 and gr["metrics"]["recall"] == 75.0
    assert any('"Greeting": precision 60%' in x for x in texts(d, "warn"))


def test_activity_and_funnel(client, auth):
    pid = project(client, auth)
    v1, v2, _v3 = video(pid, "a"), video(pid, "b"), video(pid, "c")
    count(client, auth, v1, pid, 3, 3, 3)
    count(client, auth, v2, pid, 2, None)
    a = dash(client, auth)["activity"]
    assert a["funnel"] == {"added": 3, "marked": 2, "sakshi": 1, "tp": 1}
    assert sum(x["marks"] for x in a["marks_per_day"]) == 5 and a["videos_per_day"][0]["videos"] == 3


def test_requires_login_and_isolates_users(client, auth):
    assert client.get("/api/dashboard").status_code == 401
    pid = project(client, auth)
    count(client, auth, video(pid, "mine"), pid, 1, 1, 1)
    _, other = make_user("b@x.com")
    d = dash(client, other)
    assert d["videos"] == [] and d["projects"] == [] and d["cards"]["added"] == 0
    assert client.get("/api/dashboard/health", headers=other).status_code == 200


# ---------------- health ----------------

def test_health_reports_each_service_independently(client, auth, monkeypatch):
    class Boom:
        def ping(self): raise ConnectionError("redis down")

    monkeypatch.setattr(control, "_r", lambda: Boom())
    monkeypatch.setattr(storage, "free_bytes", lambda path=None: 100 * 1024**3)
    h = client.get("/api/dashboard/health", headers=auth).json()
    assert h["services"]["redis"]["state"] == "down" and "redis down" in h["services"]["redis"]["note"]
    assert h["services"]["relay"]["state"] == "off"  # relay disabled in tests
    assert h["services"]["disk"]["state"] == "up" and h["services"]["disk"]["free_bytes"] == 100 * 1024**3


def test_health_relay_and_disk_warnings(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "rtsp_relay", True)
    monkeypatch.setattr(relay, "_call", lambda *a, **k: (_ for _ in ()).throw(relay.RelayError(relay.NOT_RUNNING)))
    monkeypatch.setattr(storage, "free_bytes", lambda path=None: settings.min_free_disk_bytes + 1)
    h = client.get("/api/dashboard/health", headers=auth).json()
    assert h["services"]["relay"]["state"] == "down" and "relay is not running" in h["services"]["relay"]["note"]
    assert h["services"]["disk"]["state"] == "warn"
    monkeypatch.setattr(relay, "_call", lambda *a, **k: (200, {}))
    assert client.get("/api/dashboard/health", headers=auth).json()["services"]["relay"]["state"] == "up"


def test_health_recordings_and_cameras(client, auth, monkeypatch):
    from app import liveness
    pid = project(client, auth)
    cam_ok, cam_failed, cam_never = camera(pid, "ok"), camera(pid, "failed"), camera(pid, "never")
    rec = video(pid, "rec", camera=cam_ok, status="recording")
    video(pid, "bad", camera=cam_failed, status="failed")
    video(pid, "proc", status="processing")
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set())  # nothing is really recording it
    h = client.get("/api/dashboard/health", headers=auth).json()
    assert h["recordings"]["active"] == 1 and h["recordings"]["processing"] == 1 and h["recordings"]["failed_7d"] == 1
    assert h["recordings"]["stuck"] == [{"id": rec, "name": "rec"}]
    assert (h["cameras"]["total"], h["cameras"]["recording"], h["cameras"]["never_recorded"]) == (3, 1, 1)
    assert h["cameras"]["last_failed"] == [{"id": cam_failed, "name": "failed"}]
    assert [p["name"] for p in h["problems"]] == ["bad"]
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: None)  # Redis down: cannot tell
    h = client.get("/api/dashboard/health", headers=auth).json()
    assert h["recordings"]["stuck"] == [] and h["recordings"]["stuck_unknown"] is True
    assert cam_never
