"""Pure comparison math. None = not entered (never treated as 0)."""
from dataclasses import dataclass
from typing import Iterable


@dataclass
class Manual:
    in_count: int
    out_count: int
    male: int
    female: int

    @property
    def total(self) -> int:
        return self.in_count + self.out_count


def manual_counts(marks: Iterable) -> Manual:
    i = o = m = f = 0
    for mk in marks:
        if mk.direction == "in":
            i += 1
        else:
            o += 1
        if mk.gender == "male":
            m += 1
        elif mk.gender == "female":
            f += 1
    return Manual(i, o, m, f)


def compare_metric(manual: int, sakshi: int | None) -> dict:
    if sakshi is None:
        return {"manual": manual, "sakshi": None, "diff": None, "percent": None, "status": "not_entered"}
    diff = sakshi - manual
    if manual == 0:
        return {"manual": manual, "sakshi": sakshi, "diff": diff, "percent": None, "status": "undefined"}
    return {"manual": manual, "sakshi": sakshi, "diff": diff,
            "percent": round(diff / manual * 100, 2), "status": "ok"}


def compare(manual: Manual, sakshi) -> dict:
    """`sakshi` is an object with in_count/out_count/male_count/female_count or None."""
    g = lambda n: getattr(sakshi, n, None) if sakshi is not None else None  # noqa: E731
    s_in, s_out = g("in_count"), g("out_count")
    s_total = s_in + s_out if s_in is not None and s_out is not None else None
    return {
        "in": compare_metric(manual.in_count, s_in),
        "out": compare_metric(manual.out_count, s_out),
        "total": compare_metric(manual.total, s_total),
        "male": compare_metric(manual.male, g("male_count")),
        "female": compare_metric(manual.female, g("female_count")),
    }
