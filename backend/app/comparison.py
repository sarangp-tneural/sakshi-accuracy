"""Pure comparison math. None = not entered (never treated as 0)."""
from dataclasses import dataclass
from typing import Iterable


@dataclass
class Manual:
    in_count: int
    out_count: int
    by_type: dict[int, int]  # marks per marking type id
    total_marks: int = 0

    @property
    def total(self) -> int:
        return self.in_count + self.out_count


def manual_counts(marks: Iterable) -> Manual:
    i = o = n = 0
    by_type: dict[int, int] = {}
    for mk in marks:
        n += 1
        if mk.direction == "in":
            i += 1
        elif mk.direction == "out":
            o += 1
        tid = getattr(mk, "marking_type_id", None)
        if tid is not None:
            by_type[tid] = by_type.get(tid, 0) + 1
    return Manual(i, o, by_type, n)


def compare_metric(manual: int, sakshi: int | None) -> dict:
    if sakshi is None:
        return {"manual": manual, "sakshi": None, "diff": None, "percent": None, "status": "not_entered"}
    diff = sakshi - manual
    if manual == 0:
        return {"manual": manual, "sakshi": sakshi, "diff": diff, "percent": None, "status": "undefined"}
    return {"manual": manual, "sakshi": sakshi, "diff": diff,
            "percent": round(diff / manual * 100, 2), "status": "ok"}


def _sum_direction(types: list, counts: dict, direction: str) -> int | None:
    """Sakshi's total for a direction: the sum over that direction's markings; unknown while any current one is blank."""
    total = 0
    for t in types:
        if t.direction != direction:
            continue
        v = counts.get(t.id)
        if v is None:
            if not t.archived:
                return None
            continue
        total += v
    return total


def compare(manual: Manual, sakshi, types: list) -> dict:
    """`sakshi` is a SakshiResult-like object (counts + the old in/out columns) or None; `types` are the project's
    MarkingTypes. Archived types are only listed while they still have marks."""
    counts: dict[int, int] = {}
    legacy_in = legacy_out = None
    if sakshi is not None:
        counts = {int(k): v for k, v in (getattr(sakshi, "counts", None) or {}).items() if v is not None}
        if not counts:  # saved before markings were configurable: only in/out can still be compared
            legacy_in, legacy_out = getattr(sakshi, "in_count", None), getattr(sakshi, "out_count", None)
    if sakshi is None:
        s_in = s_out = None
    elif counts:
        s_in, s_out = _sum_direction(types, counts, "in"), _sum_direction(types, counts, "out")
    else:
        s_in, s_out = legacy_in, legacy_out
    s_total = s_in + s_out if s_in is not None and s_out is not None else None
    rows = []
    for t in types:
        if t.archived and not manual.by_type.get(t.id):
            continue
        rows.append({"id": t.id, "label": t.label, "direction": t.direction, "archived": t.archived,
                     **compare_metric(manual.by_type.get(t.id, 0), counts.get(t.id))})
    return {
        "in": compare_metric(manual.in_count, s_in),
        "out": compare_metric(manual.out_count, s_out),
        "total": compare_metric(manual.total, s_total),
        "types": rows,
    }
