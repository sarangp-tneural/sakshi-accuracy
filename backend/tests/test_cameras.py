import pytest
from sqlalchemy import event, select

from app import rtsp, worker
from app.config import settings
from app.db import SessionLocal, engine
from app.models import Camera, Project, Video
from tests.conftest import make_user

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1"
URL2 = "rtsp://admin:other@10.0.0.9:554/stream2"


@pytest.fixture
def pid(client, auth):
    return client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]


def make(client, auth, pid, name="Entrance", url=URL, minutes=30):
    return client.post(f"/api/projects/{pid}/cameras", json={"name": name, "url": url, "default_minutes": minutes}, headers=auth)


@pytest.fixture
def queued(monkeypatch):
    calls = []
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: calls.append(vid))
    return calls


def stored_link(video_id):
    with SessionLocal() as db:
        return rtsp.decrypt_url(db.get(Video, video_id).rtsp_url_enc)


def test_create_and_list_never_expose_the_link(client, auth, pid):
    r = make(client, auth, pid)
    assert r.status_code == 201 and r.json()["name"] == "Entrance" and r.json()["default_minutes"] == 30
    lst = client.get(f"/api/projects/{pid}/cameras", headers=auth)
    assert lst.status_code == 200 and len(lst.json()) == 1
    for text in (r.text, lst.text):
        assert "s3cret" not in text and "admin" not in text and "10.0.0.5:554" in text
    assert lst.json()[0]["rtsp_url_masked"] == "rtsp://***:***@10.0.0.5:554/stream1"
    assert lst.json()[0]["recording_video_id"] is None and lst.json()[0]["last_recorded_at"] is None


def test_the_link_is_stored_encrypted(client, auth, pid):
    cid = make(client, auth, pid).json()["id"]
    with SessionLocal() as db:
        c = db.get(Camera, cid)
        assert "s3cret" not in c.rtsp_url_enc and rtsp.decrypt_url(c.rtsp_url_enc) == URL


@pytest.mark.parametrize("body", [
    {"name": "x", "url": "http://nope", "default_minutes": 30},
    {"name": "x", "url": URL, "default_minutes": 0},
    {"name": "x", "url": URL, "default_minutes": 121},
    {"name": "   ", "url": URL, "default_minutes": 30},
    {"name": "", "url": URL, "default_minutes": 30},
    {"name": "x" * 101, "url": URL, "default_minutes": 30},
    {"name": "x", "url": "rtsp://", "default_minutes": 30},
])
def test_invalid_cameras_are_rejected(client, auth, pid, body):
    assert client.post(f"/api/projects/{pid}/cameras", json=body, headers=auth).status_code == 422


def test_names_are_unique_per_project_ignoring_case(client, auth, pid):
    assert make(client, auth, pid, "Entrance").status_code == 201
    assert make(client, auth, pid, " entrance ").status_code == 409
    other = client.post("/api/projects", json={"name": "q"}, headers=auth).json()["id"]
    assert make(client, auth, other, "Entrance").status_code == 201  # another project may reuse the name
    b = make(client, auth, pid, "Billing").json()["id"]
    assert client.patch(f"/api/cameras/{b}", json={"name": "ENTRANCE"}, headers=auth).status_code == 409
    assert client.patch(f"/api/cameras/{b}", json={"name": "BILLING"}, headers=auth).status_code == 200  # own name, other case


def test_a_project_has_at_most_20_cameras(client, auth, pid):
    for i in range(20):
        assert make(client, auth, pid, f"cam{i}").status_code == 201
    assert make(client, auth, pid, "one too many").status_code == 409


def test_patch_without_url_keeps_the_link_and_with_url_replaces_it(client, auth, pid, queued):
    cid = make(client, auth, pid).json()["id"]
    r = client.patch(f"/api/cameras/{cid}", json={"name": "Front door", "default_minutes": 10}, headers=auth)
    assert r.status_code == 200 and r.json()["name"] == "Front door" and r.json()["default_minutes"] == 10
    vid = client.post(f"/api/cameras/{cid}/record", headers=auth).json()["id"]
    assert stored_link(vid) == URL  # unchanged
    with SessionLocal() as db:
        db.get(Video, vid).status = "ready"
        db.commit()
    r = client.patch(f"/api/cameras/{cid}", json={"url": URL2}, headers=auth)
    assert r.status_code == 200 and "other" not in r.text and r.json()["rtsp_url_masked"] == "rtsp://***:***@10.0.0.9:554/stream2"
    assert stored_link(client.post(f"/api/cameras/{cid}/record", headers=auth).json()["id"]) == URL2
    assert client.patch(f"/api/cameras/{cid}", json={"url": "ftp://x"}, headers=auth).status_code == 422
    assert client.patch(f"/api/cameras/{cid}", json={"default_minutes": 500}, headers=auth).status_code == 422


def test_record_uses_the_saved_link_and_length(client, auth, pid, queued):
    cid = make(client, auth, pid, "Entrance", URL, 15).json()["id"]
    r = client.post(f"/api/cameras/{cid}/record", headers=auth)
    assert r.status_code == 201
    v = r.json()
    assert v["status"] == "connecting" and v["rtsp_minutes"] == 15 and v["camera_id"] == cid and v["source"] == "rtsp"
    assert v["name"].startswith("Entrance ") and "s3cret" not in r.text and "admin" not in r.text
    assert stored_link(v["id"]) == URL and queued == [v["id"]]
    assert v["rtsp_url_masked"] == "rtsp://***:***@10.0.0.5:554/stream1"


def test_record_length_override_applies_to_that_run_only(client, auth, pid, queued):
    cid = make(client, auth, pid, minutes=30).json()["id"]
    v = client.post(f"/api/cameras/{cid}/record", json={"minutes": 5}, headers=auth).json()
    assert v["rtsp_minutes"] == 5
    assert client.get(f"/api/projects/{pid}/cameras", headers=auth).json()[0]["default_minutes"] == 30
    with SessionLocal() as db:
        db.get(Video, v["id"]).status = "ready"
        db.commit()
    assert client.post(f"/api/cameras/{cid}/record", headers=auth).json()["rtsp_minutes"] == 30
    with SessionLocal() as db:
        for x in db.scalars(select(Video)):
            x.status = "ready"
        db.commit()
    assert client.post(f"/api/cameras/{cid}/record", json={"minutes": 0}, headers=auth).status_code == 422
    assert client.post(f"/api/cameras/{cid}/record", json={"minutes": 121}, headers=auth).status_code == 422


def test_a_camera_that_is_recording_cannot_be_started_again(client, auth, pid, queued):
    a = make(client, auth, pid, "A").json()["id"]
    b = make(client, auth, pid, "B", URL2).json()["id"]
    first = client.post(f"/api/cameras/{a}/record", headers=auth)
    assert first.status_code == 201
    assert client.post(f"/api/cameras/{a}/record", headers=auth).status_code == 409
    assert client.post(f"/api/cameras/{b}/record", headers=auth).status_code == 201  # other cameras are independent
    cams = {c["name"]: c for c in client.get(f"/api/projects/{pid}/cameras", headers=auth).json()}
    assert cams["A"]["recording_video_id"] == first.json()["id"] and cams["A"]["last_recorded_at"] is not None
    assert cams["A"]["recording_minutes"] == 30 and "recording_started_at" in cams["A"]
    with SessionLocal() as db:
        db.get(Video, first.json()["id"]).status = "ready"
        db.commit()
    assert client.post(f"/api/cameras/{a}/record", headers=auth).status_code == 201  # free again once it finished
    assert len(queued) == 3


def test_disk_guard_applies_to_saved_cameras(client, auth, pid, queued, monkeypatch):
    cid = make(client, auth, pid).json()["id"]
    monkeypatch.setattr(settings, "min_free_disk_bytes", 10**18)
    assert client.post(f"/api/cameras/{cid}/record", headers=auth).status_code == 507
    assert queued == []
    with SessionLocal() as db:
        assert db.scalar(select(Video.id)) is None


def test_an_unreadable_saved_link_gives_a_clear_message(client, auth, pid, queued, monkeypatch):
    cid = make(client, auth, pid).json()["id"]
    from cryptography.fernet import Fernet
    monkeypatch.setattr(rtsp, "_fernet", lambda: Fernet(Fernet.generate_key()))  # as if the secret key had changed
    r = client.post(f"/api/cameras/{cid}/record", headers=auth)
    assert r.status_code == 409 and "enter the link again" in r.json()["detail"] and queued == []
    assert client.post(f"/api/cameras/{cid}/preview", headers=auth).status_code == 409
    assert client.get(f"/api/projects/{pid}/cameras", headers=auth).status_code == 200  # listing needs no decryption


def test_preview_returns_a_frame_and_hides_secrets(client, auth, pid, monkeypatch):
    cid = make(client, auth, pid).json()["id"]
    monkeypatch.setattr(rtsp, "grab_frame", lambda u: b"\xff\xd8jpg" if u == URL else b"")
    r = client.post(f"/api/cameras/{cid}/preview", headers=auth)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.headers["cache-control"] == "no-store"

    def fail(u):
        raise RuntimeError(f"cannot open {u} (pass s3cret)")
    monkeypatch.setattr(rtsp, "grab_frame", fail)
    r = client.post(f"/api/cameras/{cid}/preview", headers=auth)
    assert r.status_code == 502 and "s3cret" not in r.text


def test_deleting_a_camera_keeps_its_recordings(client, auth, pid, queued):
    cid = make(client, auth, pid).json()["id"]
    vid = client.post(f"/api/cameras/{cid}/record", headers=auth).json()["id"]
    assert client.delete(f"/api/cameras/{cid}", headers=auth).status_code == 204
    assert client.get(f"/api/projects/{pid}/cameras", headers=auth).json() == []
    v = client.get(f"/api/videos/{vid}", headers=auth).json()
    assert v["camera_id"] is None and v["camera_name"] is None and v["status"] == "connecting"
    assert client.delete(f"/api/cameras/{cid}", headers=auth).status_code == 404


def test_deleting_a_project_removes_its_cameras(client, auth, pid):
    cid = make(client, auth, pid).json()["id"]
    with SessionLocal() as db:
        db.delete(db.get(Project, pid))
        db.commit()
        assert db.get(Camera, cid) is None


def test_other_users_cannot_touch_cameras(client, auth, pid, queued):
    cid = make(client, auth, pid).json()["id"]
    _, other = make_user("b@x.com")
    assert client.get(f"/api/projects/{pid}/cameras", headers=other).status_code == 404
    assert make(client, other, pid, "mine").status_code == 404
    for method, path, kw in [("patch", f"/api/cameras/{cid}", {"json": {"name": "x"}}), ("delete", f"/api/cameras/{cid}", {}),
                             ("post", f"/api/cameras/{cid}/record", {}), ("post", f"/api/cameras/{cid}/preview", {})]:
        assert getattr(client, method)(path, headers=other, **kw).status_code == 404
    assert client.get(f"/api/projects/{pid}/cameras").status_code == 401
    assert queued == []


def test_videos_show_their_camera_name_without_extra_queries_per_video(client, auth, pid, queued):
    cams = [make(client, auth, pid, f"cam{i}", URL).json()["id"] for i in range(3)]

    def statements():
        seen = []
        def on(conn, cursor, statement, *a):
            seen.append(statement)
        event.listen(engine, "before_cursor_execute", on)
        try:
            r = client.get(f"/api/projects/{pid}/videos", params={"page_size": 100}, headers=auth)
            assert r.status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", on)
        return len(seen), r.json()["items"]

    with SessionLocal() as db:
        for i in range(3):
            db.add(Video(project_id=pid, name=f"v{i}", source="rtsp", status="ready", camera_id=cams[i % 3]))
        db.commit()
    few, items = statements()
    assert {v["camera_name"] for v in items} == {"cam0", "cam1", "cam2"}
    with SessionLocal() as db:
        for i in range(30):
            db.add(Video(project_id=pid, name=f"w{i}", source="rtsp", status="ready", camera_id=cams[i % 3]))
        db.commit()
    many, _ = statements()
    assert few == many


def test_the_one_off_record_endpoint_still_works(client, auth, pid, queued):
    r = client.post(f"/api/projects/{pid}/videos/rtsp", json={"url": URL, "minutes": 5}, headers=auth)
    assert r.status_code == 201 and r.json()["camera_id"] is None and r.json()["rtsp_minutes"] == 5 and "s3cret" not in r.text
    assert client.post(f"/api/projects/{pid}/videos/rtsp", json={"url": "http://x", "minutes": 5}, headers=auth).status_code == 422
    assert client.post(f"/api/projects/{pid}/videos/rtsp", json={"url": URL, "minutes": 500}, headers=auth).status_code == 422
