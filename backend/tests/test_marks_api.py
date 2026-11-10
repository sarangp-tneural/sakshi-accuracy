from tests.conftest import make_user


def mk(client, auth, vid, t=1.0, d="in", g="male"):
    return client.post(f"/api/videos/{vid}/marks", json={"time_s": t, "direction": d, "gender": g}, headers=auth)


def test_create_list_sorted(client, auth, video):
    mk(client, auth, video, 5)
    mk(client, auth, video, 2, "out", "female")
    r = client.get(f"/api/videos/{video}/marks", headers=auth).json()
    assert [m["time_s"] for m in r] == [2, 5]


def test_validation(client, auth, video):
    assert mk(client, auth, video, -1).status_code == 422
    assert mk(client, auth, video, 1, "sideways").status_code == 422
    assert mk(client, auth, video, 1, "in", "robot").status_code == 422
    assert mk(client, auth, video, 500).status_code == 422  # beyond duration (100)


def test_patch_and_delete(client, auth, video):
    m = mk(client, auth, video).json()
    r = client.patch(f"/api/marks/{m['id']}", json={"time_s": 3.5, "gender": "female"}, headers=auth).json()
    assert r["time_s"] == 3.5 and r["gender"] == "female" and r["direction"] == "in"
    assert client.patch(f"/api/marks/{m['id']}", json={"direction": None}, headers=auth).status_code == 422
    assert client.delete(f"/api/marks/{m['id']}", headers=auth).status_code == 204
    assert client.get(f"/api/videos/{video}/marks", headers=auth).json() == []


def test_undo_removes_last_created_not_latest_time(client, auth, video):
    mk(client, auth, video, 50)
    second = mk(client, auth, video, 10).json()  # created last, earlier in time
    r = client.delete(f"/api/videos/{video}/marks/last", headers=auth)
    assert r.status_code == 200 and r.json()["id"] == second["id"]
    assert len(client.get(f"/api/videos/{video}/marks", headers=auth).json()) == 1
    client.delete(f"/api/videos/{video}/marks/last", headers=auth)
    assert client.delete(f"/api/videos/{video}/marks/last", headers=auth).status_code == 404


def test_other_user_cannot_access(client, auth, video):
    m = mk(client, auth, video).json()
    _, other = make_user("b@x.com")
    assert client.get(f"/api/videos/{video}/marks", headers=other).status_code == 404
    assert client.delete(f"/api/marks/{m['id']}", headers=other).status_code == 404
    assert mk(client, other, video).status_code == 404


def test_sakshi_and_comparison_and_export(client, auth, video):
    mk(client, auth, video, 1, "in", "male")
    mk(client, auth, video, 2, "in", "female")
    assert client.put(f"/api/videos/{video}/sakshi", json={"in_count": 3, "out_count": 0}, headers=auth).status_code == 200
    s = client.get(f"/api/videos/{video}/sakshi", headers=auth).json()
    assert s["in_count"] == 3 and s["out_count"] == 0 and s["male_count"] is None
    c = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    assert c["in"]["diff"] == 1 and c["in"]["percent"] == 50.0
    assert c["out"]["status"] == "undefined"  # manual 0, sakshi 0
    assert c["male"]["status"] == "not_entered"
    assert client.put(f"/api/videos/{video}/sakshi", json={"in_count": -1}, headers=auth).status_code == 422
    csv_ = client.get(f"/api/videos/{video}/export.csv", headers=auth)
    assert csv_.status_code == 200 and "# marks" in csv_.text and "in,2,3,1,50.0,ok" in csv_.text
    x = client.get(f"/api/videos/{video}/export.xlsx", headers=auth)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    # download links use ?token=
    tok = auth["Authorization"][7:]
    assert client.get(f"/api/videos/{video}/export.csv?token={tok}").status_code == 200
