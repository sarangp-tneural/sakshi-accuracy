"""Accuracy metrics of Sakshi against the manual count. Pure arithmetic (no DB), so results are exact and testable.

actual = manual IN+OUT total, system = Sakshi IN+OUT total, tp = system counts that were real visitors.
How tp was obtained does not matter here: typed by hand today, matched from timestamps later.
A metric with a missing input or a zero divisor is None ("not entered" / "not defined"), never 0.
"""
from typing import Iterable

INPUT_FIELDS = ("tp", "gender_assigned", "real_male_in_tp", "real_female_in_tp", "correct_male", "correct_female")


def _pct(num: int | None, den: int | None) -> float | None:
    if num is None or den is None or den <= 0:
        return None
    return round(num / den * 100, 2)


def _sub(a: int | None, b: int | None) -> int | None:
    return None if a is None or b is None else a - b


def evaluate(actual: int, system: int | None, inp: dict) -> dict:
    tp = inp.get("tp")
    cm, cf = inp.get("correct_male"), inp.get("correct_female")
    correct = cm + cf if cm is not None and cf is not None else None
    return {
        "actual": actual, "system": system, "tp": tp,
        "fp": _sub(system, tp), "fn": _sub(actual, tp) if tp is not None else None,
        "over_under": _sub(system, actual),
        "precision": _pct(tp, system), "recall": _pct(tp, actual),
        "gender_accuracy": _pct(correct, tp),
        "male_accuracy": _pct(cm, inp.get("real_male_in_tp")),
        "female_accuracy": _pct(cf, inp.get("real_female_in_tp")),
        "gender_coverage": _pct(inp.get("gender_assigned"), system),
    }


def validate(actual: int, system: int | None, inp: dict) -> list[str]:
    """Why these numbers cannot be right (empty list = fine). Only checks what has been entered."""
    errs: list[str] = []
    tp = inp.get("tp")
    g = lambda k: inp.get(k)  # noqa: E731
    if tp is not None:
        if tp > actual:
            errs.append(f"TP ({tp}) cannot be more than the actual count ({actual})")
        if system is not None and tp > system:
            errs.append(f"TP ({tp}) cannot be more than the system count ({system})")
    if g("gender_assigned") is not None and system is not None and g("gender_assigned") > system:
        errs.append(f"Counts with a gender ({g('gender_assigned')}) cannot be more than the system count ({system})")
    if tp is not None:
        if g("real_male_in_tp") is not None and g("real_female_in_tp") is not None and g("real_male_in_tp") + g("real_female_in_tp") > tp:
            errs.append("Real men + real women in TP cannot be more than TP")
        if g("correct_male") is not None and g("correct_female") is not None and g("correct_male") + g("correct_female") > tp:
            errs.append("Correct men + correct women cannot be more than TP")
        for one in ("real_male_in_tp", "real_female_in_tp", "correct_male", "correct_female"):
            if g(one) is not None and g(one) > tp:
                errs.append(f"{one.replace('_', ' ')} cannot be more than TP")
    if g("correct_male") is not None and g("real_male_in_tp") is not None and g("correct_male") > g("real_male_in_tp"):
        errs.append("Correctly classified men cannot be more than the real men in TP")
    if g("correct_female") is not None and g("real_female_in_tp") is not None and g("correct_female") > g("real_female_in_tp"):
        errs.append("Correctly classified women cannot be more than the real women in TP")
    return errs


def rollup(rows: Iterable[dict]) -> dict:
    """Totals over videos: sum the counts first, then divide (not an average of percentages).
    Only videos with both a system count and a TP take part; a gender metric only uses videos that entered its fields."""
    used = [r for r in rows if r.get("tp") is not None and r.get("system") is not None]
    total = {"actual": sum(r["actual"] for r in used), "system": sum(r["system"] for r in used)}
    inp: dict = {"tp": sum(r["tp"] for r in used)}

    def entered(*fields: str):
        return [r for r in used if all(r.get(f) is not None for f in fields)]

    male = entered("real_male_in_tp", "correct_male")
    female = entered("real_female_in_tp", "correct_female")
    both = [r for r in used if all(r.get(f) is not None for f in ("correct_male", "correct_female"))]
    cov = [r for r in used if r.get("gender_assigned") is not None]
    inp["real_male_in_tp"] = sum(r["real_male_in_tp"] for r in male) if male else None
    inp["correct_male"] = sum(r["correct_male"] for r in male) if male else None
    inp["real_female_in_tp"] = sum(r["real_female_in_tp"] for r in female) if female else None
    inp["correct_female"] = sum(r["correct_female"] for r in female) if female else None
    out = evaluate(total["actual"], total["system"], inp)
    # overall gender accuracy only over videos that entered both correct counts; coverage over those that entered it
    out["gender_accuracy"] = _pct(sum(r["correct_male"] + r["correct_female"] for r in both) if both else None,
                                  sum(r["tp"] for r in both) if both else None)
    out["gender_coverage"] = _pct(sum(r["gender_assigned"] for r in cov) if cov else None,
                                  sum(r["system"] for r in cov) if cov else None)
    out["videos"] = len(used)
    if not used:
        out.update(tp=None, fp=None, fn=None, over_under=None, system=None)
    return out


def evaluate_marking(actual: int, system: int | None, tp: int | None) -> dict:
    """The same footfall formulas for one marking (e.g. Greeting): your count, Sakshi's count, and the TP typed for it."""
    m = evaluate(actual, system, {"tp": tp})
    return {k: m[k] for k in ("actual", "system", "tp", "fp", "fn", "over_under", "precision", "recall")}


def validate_markings(rows: Iterable[dict]) -> list[str]:
    """rows: {label, actual, system, tp}. TP of a marking cannot exceed your count or Sakshi's count of it."""
    errs: list[str] = []
    for r in rows:
        if r["tp"] is None:
            continue
        if r["tp"] > r["actual"]:
            errs.append(f"{r['label']}: TP ({r['tp']}) cannot be more than the actual count ({r['actual']})")
        if r["system"] is not None and r["tp"] > r["system"]:
            errs.append(f"{r['label']}: TP ({r['tp']}) cannot be more than the system count ({r['system']})")
    return errs


def rollup_markings(rows: Iterable[dict]) -> dict:
    """One marking over several videos: rows {actual, system, tp}; videos without a system count or TP are left out."""
    used = [r for r in rows if r.get("tp") is not None and r.get("system") is not None]
    if not used:
        return {**evaluate_marking(sum(r["actual"] for r in rows), None, None), "videos": 0}
    return {**evaluate_marking(sum(r["actual"] for r in used), sum(r["system"] for r in used), sum(r["tp"] for r in used)),
            "videos": len(used)}
