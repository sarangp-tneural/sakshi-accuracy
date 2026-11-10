from types import SimpleNamespace as NS

from app.comparison import Manual, compare, compare_metric, manual_counts


def test_basic_diff_and_percent():
    assert compare_metric(10, 12) == {"manual": 10, "sakshi": 12, "diff": 2, "percent": 20.0, "status": "ok"}
    assert compare_metric(10, 8)["percent"] == -20.0


def test_blank_is_not_zero():
    c = compare_metric(10, None)
    assert c["diff"] is None and c["percent"] is None and c["status"] == "not_entered"
    z = compare_metric(10, 0)
    assert z["diff"] == -10 and z["percent"] == -100.0


def test_zero_manual_percent_undefined():
    c = compare_metric(0, 5)
    assert c["diff"] == 5 and c["percent"] is None and c["status"] == "undefined"
    assert compare_metric(0, 0)["status"] == "undefined"
    assert compare_metric(0, None)["status"] == "not_entered"


def test_total_needs_both_in_and_out():
    m = Manual(3, 2, 1, 1)
    assert compare(m, NS(in_count=4, out_count=None, male_count=None, female_count=None))["total"]["status"] == "not_entered"
    assert compare(m, NS(in_count=4, out_count=3, male_count=None, female_count=None))["total"]["sakshi"] == 7
    assert compare(m, None)["in"]["status"] == "not_entered"


def test_manual_counts():
    marks = [NS(direction="in", gender="male"), NS(direction="in", gender="unknown"),
             NS(direction="out", gender="female")]
    m = manual_counts(marks)
    assert (m.in_count, m.out_count, m.male, m.female, m.total) == (2, 1, 1, 1, 3)
