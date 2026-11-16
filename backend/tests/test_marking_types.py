from sqlalchemy import select

from app.db import SessionLocal
from app.marking_defaults import DEFAULT_MARKINGS
from app.models import Mark, MarkingType
from tests.conftest import make_user


def project(client, auth):
    return client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]


def types(client, auth, pid):
    return client.get(f"/api/projects/{pid}/marking-types", headers=auth).json()


def test_new_project_gets_the_six_defaults(client, auth):
    got = types(client, auth, project(client, auth))
    assert [(t["label"], t["direction"], t["key_code"]) for t in got] == [(l, d, k) for l, d, k, _ in DEFAULT_MARKINGS]


def test_create_edit_and_reorder(client, auth):
    pid = project(client, auth)
    r = client.post(f"/api/projects/{pid}/marking-types", json={"label": " Greeting ", "key_code": "KeyB"}, headers=auth)
    assert r.status_code == 201 and r.json()["label"] == "Greeting" and r.json()["direction"] is None
    tid = r.json()["id"]
    r = client.patch(f"/api/marking-types/{tid}", json={"direction": "in", "color": "#00ff00"}, headers=auth)
    assert r.json()["direction"] == "in" and r.json()["color"] == "#00ff00" and r.json()["key_code"] == "KeyB"
    ids = [t["id"] for t in types(client, auth, pid)]
    r = client.put(f"/api/projects/{pid}/marking-types/order", json={"ids": ids[::-1]}, headers=auth)
    assert [t["id"] for t in r.json()] == ids[::-1]
    assert client.put(f"/api/projects/{pid}/marking-types/order", json={"ids": ids[1:]}, headers=auth).status_code == 422


def test_key_conflicts(client, auth):
    pid = project(client, auth)
    url = f"/api/projects/{pid}/marking-types"
    assert client.post(url, json={"label": "x", "key_code": "KeyF"}, headers=auth).status_code == 409  # Male IN
    assert client.post(url, json={"label": "x", "key_code": "KeyZ"}, headers=auth).status_code == 409  # player: undo
    assert client.post(url, json={"label": "x", "key_code": "Escape"}, headers=auth).status_code == 422
    assert client.post(url, json={"label": "", "key_code": "KeyB"}, headers=auth).status_code == 422
    t = types(client, auth, pid)[0]  # keeping its own key is fine
    assert client.patch(f"/api/marking-types/{t['id']}", json={"key_code": t["key_code"]}, headers=auth).status_code == 200


def test_delete_frees_key_and_archives_when_used(client, auth, video):
    pid = client.get("/api/projects", headers=auth).json()[0]["id"]
    male_in = types(client, auth, pid)[0]
    client.post(f"/api/videos/{video}/marks", json={"time_s": 1, "marking_type_id": male_in["id"]}, headers=auth)
    assert client.delete(f"/api/marking-types/{male_in['id']}", headers=auth).status_code == 204
    left = types(client, auth, pid)
    archived = next(t for t in left if t["id"] == male_in["id"])
    assert archived["archived"] and archived["mark_count"] == 1
    assert client.patch(f"/api/marking-types/{male_in['id']}", json={"label": "z"}, headers=auth).status_code == 409
    # its key is free again, and an archived type cannot take new marks
    assert client.post(f"/api/projects/{pid}/marking-types", json={"label": "Greeting", "key_code": "KeyF"}, headers=auth).status_code == 201
    r = client.post(f"/api/videos/{video}/marks", json={"time_s": 2, "marking_type_id": male_in["id"]}, headers=auth)
    assert r.status_code == 422
    # an unused one is really deleted
    g = next(t for t in types(client, auth, pid) if t["label"] == "Greeting")
    client.delete(f"/api/marking-types/{g['id']}", headers=auth)
    assert all(t["id"] != g["id"] for t in types(client, auth, pid))


def test_changing_direction_moves_existing_marks(client, auth, video):
    pid = client.get("/api/projects", headers=auth).json()[0]["id"]
    t = client.post(f"/api/projects/{pid}/marking-types", json={"label": "Greeting", "key_code": "KeyB"}, headers=auth).json()
    client.post(f"/api/videos/{video}/marks", json={"time_s": 1, "marking_type_id": t["id"]}, headers=auth)
    v = client.get(f"/api/projects/{pid}/videos", headers=auth).json()["items"][0]
    assert (v["mark_total"], v["mark_in"], v["mark_out"], v["mark_types"]) == (1, 0, 0, {str(t["id"]): 1})
    client.patch(f"/api/marking-types/{t['id']}", json={"direction": "out"}, headers=auth)
    v = client.get(f"/api/projects/{pid}/videos", headers=auth).json()["items"][0]
    assert (v["mark_in"], v["mark_out"]) == (0, 1)


def test_other_users_project_is_hidden(client, auth):
    pid = project(client, auth)
    t = types(client, auth, pid)[0]
    _, other = make_user("b@x.com")
    assert client.get(f"/api/projects/{pid}/marking-types", headers=other).status_code == 404
    assert client.delete(f"/api/marking-types/{t['id']}", headers=other).status_code == 404
    assert client.patch(f"/api/marking-types/{t['id']}", json={"label": "x"}, headers=other).status_code == 404


def test_mark_must_use_a_type_of_its_own_project(client, auth, video):
    other_pid = project(client, auth)
    foreign = types(client, auth, other_pid)[0]
    r = client.post(f"/api/videos/{video}/marks", json={"time_s": 1, "marking_type_id": foreign["id"]}, headers=auth)
    assert r.status_code == 422


def test_deleting_the_project_removes_its_types(client, auth):
    pid = project(client, auth)
    assert client.delete(f"/api/projects/{pid}", headers=auth).status_code == 204
    with SessionLocal() as db:
        assert db.scalars(select(MarkingType)).all() == []
