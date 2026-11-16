from tests.conftest import make_user


def type_id(client, auth, vid, label="Male IN"):
    pid = client.get(f"/api/videos/{vid}", headers=auth).json()["project_id"]
    ts = client.get(f"/api/projects/{pid}/marking-types", headers=auth).json()
    return next(t["id"] for t in ts if t["label"] == label)


def mk(client, auth, vid, t=1.0, label="Male IN"):
    r = client.get(f"/api/videos/{vid}", headers=auth)
    if r.status_code != 200:
        return r
    return client.post(f"/api/videos/{vid}/marks", json={"time_s": t, "marking_type_id": type_id(client, auth, vid, label)},
                       headers=auth)


def test_create_list_sorted(client, auth, video):
    mk(client, auth, video, 5)
    mk(client, auth, video, 2, "Female OUT")
    r = client.get(f"/api/videos/{video}/marks", headers=auth).json()
    assert [m["time_s"] for m in r] == [2, 5]


def test_validation(client, auth, video):
    assert mk(client, auth, video, -1).status_code == 422
    r = client.post(f"/api/videos/{video}/marks", json={"time_s": 1, "marking_type_id": 99999}, headers=auth)
    assert r.status_code == 422
    r = client.post(f"/api/videos/{video}/marks", json={"time_s": 1}, headers=auth)
    assert r.status_code == 422
    assert mk(client, auth, video, 500).status_code == 422  # beyond duration (100)


def test_patch_and_delete(client, auth, video):
    m = mk(client, auth, video).json()
    fin = type_id(client, auth, video, "Female IN")
    r = client.patch(f"/api/marks/{m['id']}", json={"time_s": 3.5, "marking_type_id": fin}, headers=auth).json()
    assert r["time_s"] == 3.5 and r["marking_type_id"] == fin and r["direction"] == "in"
    fout = type_id(client, auth, video, "Female OUT")
    assert client.patch(f"/api/marks/{m['id']}", json={"marking_type_id": fout}, headers=auth).json()["direction"] == "out"
    assert client.patch(f"/api/marks/{m['id']}", json={"marking_type_id": None}, headers=auth).status_code == 422
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
    mk(client, auth, video, 1, "Male IN")
    mk(client, auth, video, 2, "Female IN")
    mi, fi = type_id(client, auth, video, "Male IN"), type_id(client, auth, video, "Female IN")
    mo = type_id(client, auth, video, "Male OUT")
    c = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    assert c["in"]["status"] == "not_entered"
    # only the IN markings entered: the OUT markings are still blank, so OUT / total stay "not entered"
    r = client.put(f"/api/videos/{video}/sakshi", json={"counts": {mi: 2, fi: 1}}, headers=auth)
    assert r.status_code == 200 and r.json()["counts"] == {str(mi): 2, str(fi): 1} or r.json()["counts"] == {mi: 2, fi: 1}
    c = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    assert c["in"]["status"] == "not_entered"
    ts = {t["label"]: t for t in c["types"]}
    assert ts["Male IN"]["diff"] == 1 and ts["Male IN"]["percent"] == 100.0 and ts["Female IN"]["diff"] == 0
    assert ts["Male OUT"]["status"] == "not_entered"
    # enter everything -> totals appear
    every = {t["id"]: 0 for t in c["types"]}
    every.update({mi: 2, fi: 1})
    client.put(f"/api/videos/{video}/sakshi", json={"counts": every}, headers=auth)
    c = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    assert c["in"]["sakshi"] == 3 and c["in"]["diff"] == 1 and c["in"]["percent"] == 50.0
    assert c["out"]["status"] == "undefined"  # manual 0, sakshi 0
    assert client.put(f"/api/videos/{video}/sakshi", json={"counts": {mi: -1}}, headers=auth).status_code == 422
    assert client.put(f"/api/videos/{video}/sakshi", json={"counts": {99999: 1}}, headers=auth).status_code == 422
    assert mo in every
    csv_ = client.get(f"/api/videos/{video}/export.csv", headers=auth)
    assert csv_.status_code == 200 and "# marks" in csv_.text and "in,2,3,1,50.0,ok" in csv_.text
    assert "Male IN,1,2,1,100.0,ok" in csv_.text
    x = client.get(f"/api/videos/{video}/export.xlsx", headers=auth)
    assert x.status_code == 200 and x.content[:2] == b"PK"
    # download links use ?token=
    tok = auth["Authorization"][7:]
    assert client.get(f"/api/videos/{video}/export.csv?token={tok}").status_code == 200


def test_blank_sakshi_form_is_not_entered(client, auth, video):
    client.put(f"/api/videos/{video}/sakshi", json={"counts": {}}, headers=auth)
    assert client.get(f"/api/videos/{video}", headers=auth).json()["sakshi_entered"] is False
    mi = type_id(client, auth, video)
    client.put(f"/api/videos/{video}/sakshi", json={"counts": {mi: 0}}, headers=auth)
    assert client.get(f"/api/videos/{video}", headers=auth).json()["sakshi_entered"] is True


def test_custom_marking_is_compared_and_exported(client, auth, video):
    pid = client.get(f"/api/videos/{video}", headers=auth).json()["project_id"]
    g = client.post(f"/api/projects/{pid}/marking-types", json={"label": "Greeting", "key_code": "KeyB"}, headers=auth).json()
    client.post(f"/api/videos/{video}/marks", json={"time_s": 1, "marking_type_id": g["id"]}, headers=auth)
    client.put(f"/api/videos/{video}/sakshi", json={"counts": {g["id"]: 2}}, headers=auth)
    c = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    assert next(t for t in c["types"] if t["label"] == "Greeting")["diff"] == 1
    assert c["in"]["manual"] == 0 and c["total"]["manual"] == 0  # no direction: not part of the totals
    text = client.get(f"/api/videos/{video}/export.csv", headers=auth).text
    assert "Greeting,1,2,1,100.0,ok" in text and ",Greeting," in text


def test_legacy_sakshi_result_still_compares_in_and_out(client, auth, video):
    from app.db import SessionLocal
    from app.models import SakshiResult
    mk(client, auth, video, 1, "Male IN")
    with SessionLocal() as db:
        db.add(SakshiResult(video_id=video, in_count=3, out_count=0, male_count=2))
        db.commit()
    s = client.get(f"/api/videos/{video}/sakshi", headers=auth).json()
    assert s["counts"] == {} and s["legacy"] == {"in": 3, "out": 0, "male": 2}
    c = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    assert c["in"]["diff"] == 2 and c["total"]["sakshi"] == 3


def test_point_set_replace_clear(client, auth, video):
    m = mk(client, auth, video).json()
    assert m["x"] is None and m["y"] is None
    r = client.put(f"/api/marks/{m['id']}/point", json={"x": 0.25, "y": 0.75}, headers=auth)
    assert r.status_code == 200 and (r.json()["x"], r.json()["y"]) == (0.25, 0.75)
    # survives a time nudge and appears in the list
    client.patch(f"/api/marks/{m['id']}", json={"time_s": 4.0}, headers=auth)
    got = client.get(f"/api/videos/{video}/marks", headers=auth).json()[0]
    assert (got["x"], got["y"], got["time_s"]) == (0.25, 0.75, 4.0)
    assert client.put(f"/api/marks/{m['id']}/point", json={"x": 1, "y": 0}, headers=auth).json()["x"] == 1
    r = client.delete(f"/api/marks/{m['id']}/point", headers=auth)
    assert r.status_code == 200 and r.json()["x"] is None and r.json()["y"] is None


def test_point_validation_and_ownership(client, auth, video):
    m = mk(client, auth, video).json()
    for bad in ({"x": -0.1, "y": 0.5}, {"x": 0.5, "y": 1.01}, {"x": 0.5}, {"x": "a", "y": 0.5}):
        assert client.put(f"/api/marks/{m['id']}/point", json=bad, headers=auth).status_code == 422
    _, other = make_user("b@x.com")
    assert client.put(f"/api/marks/{m['id']}/point", json={"x": 0.5, "y": 0.5}, headers=other).status_code == 404
    assert client.delete(f"/api/marks/{m['id']}/point", headers=other).status_code == 404
    assert client.get(f"/api/videos/{video}/marks", headers=auth).json()[0]["x"] is None


def test_export_includes_point_columns(client, auth, video):
    a = mk(client, auth, video, 1).json()
    mk(client, auth, video, 2)
    client.put(f"/api/marks/{a['id']}/point", json={"x": 0.1234567, "y": 0.5}, headers=auth)
    text = client.get(f"/api/videos/{video}/export.csv", headers=auth).text
    assert "id,time_s,marking,direction,x,y,created_at" in text
    assert ",0.1235,0.5," in text
    line2 = [ln for ln in text.splitlines() if ln.split(",")[1:2] == ["2.0"]][0]
    assert line2.split(",")[4:6] == ["", ""]
