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


def T(id, direction, archived=False, label=None):
    return NS(id=id, direction=direction, archived=archived, label=label or f"t{id}")


def test_totals_sum_the_markings_of_each_direction():
    types = [T(1, "in"), T(2, "in"), T(3, "out"), T(4, None)]
    m = Manual(3, 2, {1: 2, 2: 1, 3: 2, 4: 5}, 10)
    c = compare(m, NS(counts={"1": 2, "2": 3, "3": 1, "4": 0}, in_count=None, out_count=None), types)
    assert c["in"]["sakshi"] == 5 and c["out"]["sakshi"] == 1 and c["total"]["sakshi"] == 6
    assert [r["id"] for r in c["types"]] == [1, 2, 3, 4]
    assert c["types"][3]["manual"] == 5 and c["types"][3]["diff"] == -5


def test_a_blank_current_marking_makes_the_direction_total_unknown():
    types = [T(1, "in"), T(2, "in"), T(3, "out")]
    c = compare(Manual(1, 1, {}, 2), NS(counts={"1": 4, "3": 1}, in_count=None, out_count=None), types)
    assert c["in"]["status"] == "not_entered" and c["out"]["sakshi"] == 1 and c["total"]["status"] == "not_entered"


def test_nothing_entered():
    c = compare(Manual(3, 2, {}, 5), None, [T(1, "in")])
    assert c["in"]["status"] == "not_entered" and c["types"][0]["status"] == "not_entered"


def test_archived_type_listed_only_while_it_has_marks():
    types = [T(1, "in"), T(2, "in", archived=True), T(3, "out", archived=True)]
    c = compare(Manual(2, 0, {1: 1, 2: 1}, 2), NS(counts={"1": 1}, in_count=None, out_count=None), types)
    assert [r["id"] for r in c["types"]] == [1, 2]
    assert c["in"]["sakshi"] == 1  # a removed marking does not block the total


def test_legacy_result_compares_in_out_only():
    c = compare(Manual(3, 2, {}, 5), NS(counts=None, in_count=4, out_count=None), [T(1, "in")])
    assert c["in"]["sakshi"] == 4 and c["total"]["status"] == "not_entered"


def test_manual_counts():
    marks = [NS(direction="in", marking_type_id=1), NS(direction="in", marking_type_id=1),
             NS(direction="out", marking_type_id=2), NS(direction=None, marking_type_id=3)]
    m = manual_counts(marks)
    assert (m.in_count, m.out_count, m.total, m.total_marks, m.by_type) == (2, 1, 3, 4, {1: 2, 2: 1, 3: 1})
