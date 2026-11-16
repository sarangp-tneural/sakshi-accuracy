import pytest

from app.metrics import evaluate, rollup, validate
from tests.test_marks_api import mk, type_id


def test_report_example_pittappillil():
    m = evaluate(34, 55, {"tp": 27})
    assert (m["fp"], m["fn"], m["over_under"]) == (28, 7, 21)
    assert (m["precision"], m["recall"]) == (49.09, 79.41)


def test_case_a_nothing_false():
    m = evaluate(111, 103, {"tp": 103})  # Borivali
    assert m["precision"] == 100.0 and m["recall"] == 92.79 and m["fp"] == 0 and m["over_under"] == -8


def test_case_b_nothing_missed():
    m = evaluate(170, 184, {"tp": 170})  # Opera House
    assert m["precision"] == 92.39 and m["recall"] == 100.0 and m["fn"] == 0


def test_gender_on_tps_only():
    m = evaluate(20, 20, {"tp": 20, "correct_male": 13, "correct_female": 0, "real_male_in_tp": 14, "real_female_in_tp": 6})
    assert m["gender_accuracy"] == 65.0 and m["male_accuracy"] == 92.86 and m["female_accuracy"] == 0.0


def test_gender_coverage():
    assert evaluate(60, 78, {"gender_assigned": 45})["gender_coverage"] == 57.69  # Mira Road


def test_missing_input_or_zero_divisor_is_none_not_zero():
    m = evaluate(10, None, {"tp": 5})
    assert m["precision"] is None and m["fp"] is None and m["recall"] == 50.0
    m = evaluate(0, 0, {"tp": 0})
    assert m["precision"] is None and m["recall"] is None and m["fp"] == 0
    m = evaluate(10, 10, {"tp": 5, "correct_male": 2})  # correct_female blank
    assert m["gender_accuracy"] is None
    assert evaluate(10, 10, {})["fn"] is None


def test_validation():
    assert validate(34, 55, {"tp": 27}) == []
    assert validate(34, 55, {"tp": 40})  # more than actual
    assert validate(34, 20, {"tp": 25})  # more than system
    assert validate(34, 55, {"tp": 10, "correct_male": 6, "correct_female": 5})
    assert validate(34, 55, {"tp": 10, "correct_male": 6, "real_male_in_tp": 5})
    assert validate(34, 55, {"gender_assigned": 56})
    assert validate(34, None, {"tp": 30}) == []  # system not entered yet: only checked against actual


def test_rollup_sums_then_divides():
    rows = [
        {"actual": 10, "system": 20, "tp": 10},
        {"actual": 90, "system": 90, "tp": 45},
        {"actual": 50, "system": None, "tp": 5},  # no system count: left out
        {"actual": 5, "system": 5, "tp": None},  # no TP: left out
    ]
    t = rollup(rows)
    assert (t["actual"], t["system"], t["tp"], t["videos"]) == (100, 110, 55, 2)
    assert t["precision"] == 50.0 and t["recall"] == 55.0  # not the average of 50% and 50%/100%
    assert rollup([])["tp"] is None and rollup([])["videos"] == 0


def test_rollup_gender_uses_only_videos_that_entered_it():
    rows = [
        {"actual": 10, "system": 10, "tp": 10, "correct_male": 4, "correct_female": 4, "real_male_in_tp": 5, "real_female_in_tp": 5, "gender_assigned": 10},
        {"actual": 10, "system": 10, "tp": 10},
    ]
    t = rollup(rows)
    assert t["gender_accuracy"] == 80.0 and t["male_accuracy"] == 80.0 and t["gender_coverage"] == 100.0


def _count(client, auth, video, in_n, out_n):
    for i in range(in_n):
        mk(client, auth, video, 1 + i * 0.1, "Male IN")
    for i in range(out_n):
        mk(client, auth, video, 20 + i * 0.1, "Male OUT")
    ids = {t["label"]: t["id"] for t in client.get(f"/api/videos/{video}/comparison", headers=auth).json()["types"]}
    counts = {i: 0 for i in ids.values()}
    return counts, ids


def test_evaluation_api_end_to_end(client, auth, video):
    counts, ids = _count(client, auth, video, 3, 1)  # actual = 4
    # Sakshi counted 6 in, 0 out
    counts[ids["Male IN"]] = 6
    client.put(f"/api/videos/{video}/sakshi", json={"counts": counts}, headers=auth)
    e = client.get(f"/api/videos/{video}/evaluation", headers=auth).json()
    assert e["metrics"]["actual"] == 4 and e["metrics"]["system"] == 6 and e["metrics"]["tp"] is None
    assert e["metrics"]["over_under"] == 2 and e["metrics"]["precision"] is None
    r = client.put(f"/api/videos/{video}/evaluation", json={"tp": 3, "gender_assigned": 4}, headers=auth)
    assert r.status_code == 200
    m = r.json()["metrics"]
    assert (m["fp"], m["fn"], m["precision"], m["recall"], m["gender_coverage"]) == (3, 1, 50.0, 75.0, 66.67)
    # the Sakshi form still saves without wiping the evaluation
    client.put(f"/api/videos/{video}/sakshi", json={"counts": counts}, headers=auth)
    assert client.get(f"/api/videos/{video}/evaluation", headers=auth).json()["inputs"]["tp"] == 3
    # impossible numbers are refused, and nothing is saved
    assert client.put(f"/api/videos/{video}/evaluation", json={"tp": 5}, headers=auth).status_code == 422  # > actual (4)
    assert client.put(f"/api/videos/{video}/evaluation", json={"tp": -1}, headers=auth).status_code == 422
    assert client.get(f"/api/videos/{video}/evaluation", headers=auth).json()["inputs"]["tp"] == 3
    # blank clears
    client.put(f"/api/videos/{video}/evaluation", json={}, headers=auth)
    assert client.get(f"/api/videos/{video}/evaluation", headers=auth).json()["inputs"]["tp"] is None


def test_evaluation_flags_numbers_that_no_longer_add_up(client, auth, video):
    counts, ids = _count(client, auth, video, 3, 0)
    counts[ids["Male IN"]] = 3
    client.put(f"/api/videos/{video}/sakshi", json={"counts": counts}, headers=auth)
    client.put(f"/api/videos/{video}/evaluation", json={"tp": 3}, headers=auth)
    last = client.delete(f"/api/videos/{video}/marks/last", headers=auth)  # a mark is removed afterwards
    assert last.status_code == 200
    e = client.get(f"/api/videos/{video}/evaluation", headers=auth).json()
    assert e["problems"] and "TP" in e["problems"][0]


def test_evaluation_ownership_and_export(client, auth, video):
    from tests.conftest import make_user
    _, other = make_user("b@x.com")
    assert client.get(f"/api/videos/{video}/evaluation", headers=other).status_code == 404
    assert client.put(f"/api/videos/{video}/evaluation", json={}, headers=other).status_code == 404
    counts, ids = _count(client, auth, video, 2, 0)
    counts[ids["Male IN"]] = 4
    client.put(f"/api/videos/{video}/sakshi", json={"counts": counts}, headers=auth)
    client.put(f"/api/videos/{video}/evaluation", json={"tp": 2}, headers=auth)
    text = client.get(f"/api/videos/{video}/export.csv", headers=auth).text
    assert "# evaluation" in text and "precision %,50.0" in text and "recall %,100.0" in text
    assert client.get(f"/api/videos/{video}/export.xlsx", headers=auth).content[:2] == b"PK"


def test_project_rollup(client, auth, video):
    from app.db import SessionLocal
    from app.models import Video
    pid = client.get(f"/api/videos/{video}", headers=auth).json()["project_id"]
    with SessionLocal() as db:
        v2 = Video(project_id=pid, name="v2", source="upload", status="ready", duration_s=100)
        db.add(v2)
        db.commit()
        v2 = v2.id
    for vid, n_in, sys_in, tp in ((video, 2, 4, 2), (v2, 3, 3, 3)):
        counts, ids = _count(client, auth, vid, n_in, 0)
        counts[ids["Male IN"]] = sys_in
        client.put(f"/api/videos/{vid}/sakshi", json={"counts": counts}, headers=auth)
        client.put(f"/api/videos/{vid}/evaluation", json={"tp": tp}, headers=auth)
    r = client.get(f"/api/projects/{pid}/evaluation", headers=auth).json()
    assert len(r["videos"]) == 2
    t = r["total"]
    assert (t["actual"], t["system"], t["tp"], t["videos"]) == (5, 7, 5, 2)
    assert t["precision"] == 71.43 and t["recall"] == 100.0
    from tests.conftest import make_user
    _, other = make_user("b@x.com")
    assert client.get(f"/api/projects/{pid}/evaluation", headers=other).status_code == 404


def test_marking_metrics_use_the_same_formulas():
    from app.metrics import evaluate_marking, rollup_markings, validate_markings
    m = evaluate_marking(20, 25, 18)  # Greeting
    assert (m["fp"], m["fn"], m["over_under"], m["precision"], m["recall"]) == (7, 2, 5, 72.0, 90.0)
    assert evaluate_marking(20, None, 18)["precision"] is None
    assert evaluate_marking(20, 25, None)["recall"] is None
    assert validate_markings([{"label": "Greeting", "actual": 5, "system": 9, "tp": 6}])
    assert validate_markings([{"label": "Greeting", "actual": 9, "system": 5, "tp": 6}])
    assert validate_markings([{"label": "Greeting", "actual": 9, "system": None, "tp": None}]) == []
    t = rollup_markings([{"actual": 10, "system": 20, "tp": 10}, {"actual": 10, "system": 10, "tp": 5}, {"actual": 7, "system": None, "tp": 7}])
    assert (t["actual"], t["system"], t["tp"], t["videos"]) == (20, 30, 15, 2) and t["precision"] == 50.0


def _greeting(client, auth, video, marks_n, sakshi_n):
    pid = client.get(f"/api/videos/{video}", headers=auth).json()["project_id"]
    g = client.post(f"/api/projects/{pid}/marking-types", json={"label": "Greeting", "key_code": "KeyB"}, headers=auth).json()
    for i in range(marks_n):
        client.post(f"/api/videos/{video}/marks", json={"time_s": 1 + i * 0.1, "marking_type_id": g["id"]}, headers=auth)
    cmp = client.get(f"/api/videos/{video}/comparison", headers=auth).json()
    counts = {t["id"]: 0 for t in cmp["types"]}
    counts[g["id"]] = sakshi_n
    client.put(f"/api/videos/{video}/sakshi", json={"counts": counts}, headers=auth)
    return pid, g["id"]


def test_greeting_gets_its_own_precision_and_recall(client, auth, video):
    pid, gid = _greeting(client, auth, video, 4, 5)
    r = client.put(f"/api/videos/{video}/evaluation", json={"type_tp": {gid: 3}}, headers=auth)
    assert r.status_code == 200
    g = next(t for t in r.json()["types"] if t["label"] == "Greeting")
    assert (g["metrics"]["fp"], g["metrics"]["fn"], g["metrics"]["precision"], g["metrics"]["recall"]) == (2, 1, 60.0, 75.0)
    # footfall is untouched by a marking with no direction
    assert r.json()["metrics"]["actual"] == 0 and r.json()["metrics"]["tp"] is None
    assert client.get(f"/api/videos/{video}/evaluation", headers=auth).json()["inputs"]["type_tp"] == {str(gid): 3}
    # the Sakshi form saving does not wipe it
    assert client.put(f"/api/videos/{video}/sakshi", json={"counts": {gid: 5}}, headers=auth).status_code == 200
    assert client.get(f"/api/videos/{video}/evaluation", headers=auth).json()["inputs"]["type_tp"] == {str(gid): 3}
    # impossible / unknown are refused
    assert client.put(f"/api/videos/{video}/evaluation", json={"type_tp": {gid: 9}}, headers=auth).status_code == 422
    assert client.put(f"/api/videos/{video}/evaluation", json={"type_tp": {99999: 1}}, headers=auth).status_code == 422
    # exports and project roll-up
    csv_ = client.get(f"/api/videos/{video}/export.csv", headers=auth).text
    assert "# evaluation by marking" in csv_ and "Greeting,4,5,3,2,1,1,60.0,75.0" in csv_
    assert client.get(f"/api/videos/{video}/export.xlsx", headers=auth).content[:2] == b"PK"
    roll = client.get(f"/api/projects/{pid}/evaluation", headers=auth).json()
    gt = next(t for t in roll["types"] if t["label"] == "Greeting")
    assert (gt["metrics"]["tp"], gt["metrics"]["precision"], gt["metrics"]["videos"]) == (3, 60.0, 1)
