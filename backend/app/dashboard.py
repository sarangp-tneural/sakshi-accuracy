"""Everything the dashboard shows, derived from existing data (no schema, no LLM). Pure functions where possible.

Rows: one dict per video with its manual count (actual), Sakshi count (system), the typed TP/gender numbers, and per-marking
numbers. The maths is in metrics.py; this module only gathers, groups, and decides what is worth pointing out."""
from collections import defaultdict
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .comparison import Manual, compare
from .metrics import INPUT_FIELDS, evaluate, evaluate_marking, rollup, rollup_markings, validate, validate_markings
from .models import Camera, Mark, MarkingType, Project, SakshiResult, Video

# thresholds for the findings (percent)
PRECISION_WARN, PRECISION_BAD = 80.0, 60.0
RECALL_WARN, RECALL_BAD = 80.0, 60.0
COVERAGE_WARN = 60.0
COUNT_OFF_WARN, COUNT_OFF_BAD = 20.0, 50.0  # |system - actual| as a share of actual
MAX_FINDINGS = 40


def evaluation_rows(db: Session, project_ids: list[int], since: datetime | None = None) -> list[dict]:
    """One row per video of the projects (newest first): a handful of grouped queries however many videos there are."""
    if not project_ids:
        return []
    q = (select(Video, Project.name, Camera.name).join(Project, Project.id == Video.project_id)
         .outerjoin(Camera, Camera.id == Video.camera_id).where(Video.project_id.in_(project_ids))
         .order_by(Video.created_at.desc(), Video.id.desc()))
    if since is not None:
        q = q.where(Video.created_at >= since)
    found = db.execute(q).all()
    ids = [v.id for v, _p, _c in found]
    types_by_project: dict[int, list[MarkingType]] = defaultdict(list)
    for t in db.scalars(select(MarkingType).where(MarkingType.project_id.in_(project_ids))
                        .order_by(MarkingType.archived, MarkingType.sort_order, MarkingType.id)):
        types_by_project[t.project_id].append(t)
    manual: dict[int, Manual] = {i: Manual(0, 0, {}, 0) for i in ids}
    if ids:
        for vid, direction, type_id, n in db.execute(
            select(Mark.video_id, Mark.direction, Mark.marking_type_id, func.count()).where(Mark.video_id.in_(ids))
            .group_by(Mark.video_id, Mark.direction, Mark.marking_type_id)
        ):
            m = manual[vid]
            m.total_marks += n
            if direction == "in":
                m.in_count += n
            elif direction == "out":
                m.out_count += n
            if type_id is not None:
                m.by_type[type_id] = m.by_type.get(type_id, 0) + n
    saved = {r.video_id: r for r in db.scalars(select(SakshiResult).where(SakshiResult.video_id.in_(ids)))} if ids else {}
    rows = []
    for v, project_name, camera_name in found:
        r = saved.get(v.id)
        types = types_by_project[v.project_id]
        cmp = compare(manual[v.id], r, types)
        system = cmp["total"]["sakshi"]
        actual = manual[v.id].total
        inp = {k: getattr(r, k) if r else None for k in INPUT_FIELDS}
        tps = (r.tp_by_type if r else None) or {}
        type_rows = [{"id": t["id"], "label": t["label"], "direction": t["direction"], "archived": t["archived"],
                      "actual": t["manual"], "system": t["sakshi"], "tp": tps.get(str(t["id"]))} for t in cmp["types"]]
        has_sakshi = r is not None and (bool(r.counts) or any(getattr(r, k) is not None for k in ("in_count", "out_count")))
        rows.append({
            "id": v.id, "name": v.name, "status": v.status, "source": v.source, "created_at": v.created_at,
            "project_id": v.project_id, "project": project_name, "camera_id": v.camera_id, "camera": camera_name,
            "marks": manual[v.id].total_marks, "sakshi_entered": has_sakshi, "tp_source": r.tp_source if r else "manual",
            "actual": actual, "system": system, **inp,
            "metrics": evaluate(actual, system, inp),
            "problems": validate(actual, system, inp) + validate_markings(type_rows),
            "types": [{**x, "metrics": evaluate_marking(x["actual"], x["system"], x["tp"])} for x in type_rows],
        })
    return rows


def group_rows(rows: list[dict], by: str) -> list[dict]:
    """Totals per project or per camera (a video from a one-off link has no camera). Counts summed, then divided."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if by == "camera":
            key = (r["camera_id"] or 0, r["camera"] or "No camera")
        else:
            key = (r["project_id"], r["project"])
        groups[key].append(r)
    names = [label for _gid, label in groups]
    out = []
    for (gid, label), rs in groups.items():
        t = rollup(rs)
        if by == "camera" and names.count(label) > 1:
            label = f"{label} · {rs[0]['project']}"  # two cameras called the same in different projects
        out.append({"id": gid, "label": label, "videos": len(rs), "with_tp": t["videos"], "metrics": t})
    return sorted(out, key=lambda g: g["label"].lower())


def trend(rows: list[dict]) -> list[dict]:
    """Accuracy per day of the videos (by the day they were added), oldest first."""
    days: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        days[r["created_at"].date().isoformat()].append(r)
    out = []
    for d in sorted(days):
        t = rollup(days[d])
        out.append({"date": d, "videos": len(days[d]), "with_tp": t["videos"], "actual": sum(x["actual"] for x in days[d]),
                    "system": sum(x["system"] for x in days[d] if x["system"] is not None),
                    "precision": t["precision"], "recall": t["recall"]})
    return out


def marking_totals(rows: list[dict]) -> list[dict]:
    """Per marking (by name, since each project has its own list): your count, Sakshi's, TP, precision and recall."""
    by: dict[str, dict] = {}
    for r in rows:
        for t in r["types"]:
            e = by.setdefault(t["label"].strip().lower(), {"label": t["label"], "direction": t["direction"], "rows": []})
            e["rows"].append({"actual": t["actual"], "system": t["system"], "tp": t["tp"]})
    out = []
    for e in by.values():
        m = rollup_markings(e["rows"])
        out.append({"label": e["label"], "direction": e["direction"], "marked": sum(x["actual"] for x in e["rows"]), "metrics": m})
    return sorted(out, key=lambda x: -x["marked"])


def funnel(rows: list[dict]) -> dict:
    return {"added": len(rows), "marked": sum(1 for r in rows if r["marks"] > 0),
            "sakshi": sum(1 for r in rows if r["sakshi_entered"]), "tp": sum(1 for r in rows if r["tp"] is not None)}


def cards(rows: list[dict]) -> dict:
    t = rollup(rows)
    f = funnel(rows)
    off = None
    if t["system"] and t["actual"]:
        off = round((t["system"] - t["actual"]) / t["actual"] * 100, 1)
    return {**f, "metrics": t, "count_off_pct": off,
            "actual_total": sum(r["actual"] for r in rows),
            "system_total": sum(r["system"] for r in rows if r["system"] is not None)}


def _pct(v: float | None) -> str:
    return "" if v is None else f"{v:g}%"


def findings(rows: list[dict], groups: list[dict], markings: list[dict]) -> list[dict]:
    """What is worth a look, worst first. Each: {severity: bad|warn|info, text, link}. Plain rules, no guessing."""
    out: list[dict] = []

    def add(sev: str, text: str, link: str, weight: float = 0.0):
        out.append({"severity": sev, "text": text, "link": link, "_w": weight})

    for r in rows:
        m, link, name = r["metrics"], f"/videos/{r['id']}", r["name"]
        if r["problems"]:
            add("bad", f'The saved numbers on "{name}" no longer add up: {r["problems"][0]}.', link, 100)
        if r["actual"] and r["system"] is not None:
            off = (r["system"] - r["actual"]) / r["actual"] * 100
            if abs(off) >= COUNT_OFF_WARN:
                kind = "over" if off > 0 else "under"
                add("bad" if abs(off) >= COUNT_OFF_BAD else "warn",
                    f'Sakshi {kind}-counted by {m["over_under"]:+d} ({off:+.0f}%) on "{name}" (you counted {r["actual"]}, Sakshi {r["system"]}).',
                    link, abs(off))
        if m["precision"] is not None and m["precision"] < PRECISION_WARN:
            add("bad" if m["precision"] < PRECISION_BAD else "warn",
                f'Low precision on "{name}": {_pct(m["precision"])}, {m["fp"]} of Sakshi\'s {r["system"]} counts were not real visitors.', link, 100 - m["precision"])
        if m["recall"] is not None and m["recall"] < RECALL_WARN:
            add("bad" if m["recall"] < RECALL_BAD else "warn",
                f'Low recall on "{name}": {_pct(m["recall"])}, Sakshi missed {m["fn"]} of the {r["actual"]} real visitors.', link, 100 - m["recall"])
        if m["gender_coverage"] is not None and m["gender_coverage"] < COVERAGE_WARN:
            add("warn", f'Gender coverage is only {_pct(m["gender_coverage"])} on "{name}".', link, 100 - m["gender_coverage"])

    for mk in markings:
        m = mk["metrics"]
        if m["videos"] and m["precision"] is not None and m["precision"] < PRECISION_WARN:
            add("warn", f'"{mk["label"]}": precision {_pct(m["precision"])} over {m["videos"]} video{"s" if m["videos"] != 1 else ""}.', "/dashboard", 100 - m["precision"])
        if m["videos"] and m["recall"] is not None and m["recall"] < RECALL_WARN:
            add("warn", f'"{mk["label"]}": recall {_pct(m["recall"])} over {m["videos"]} video{"s" if m["videos"] != 1 else ""}.', "/dashboard", 100 - m["recall"])

    scored = [g for g in groups if g["metrics"]["recall"] is not None]
    if len(scored) >= 2:
        worst = min(scored, key=lambda g: g["metrics"]["recall"])
        best = max(scored, key=lambda g: g["metrics"]["recall"])
        if worst["metrics"]["recall"] < best["metrics"]["recall"]:
            add("info", f'Lowest recall: {worst["label"]} ({_pct(worst["metrics"]["recall"])}); highest: {best["label"]} ({_pct(best["metrics"]["recall"])}).', "/dashboard", 1)

    no_tp = [r for r in rows if r["system"] is not None and r["tp"] is None]
    if no_tp:
        add("warn", f'{len(no_tp)} video{"s have" if len(no_tp) != 1 else " has"} a Sakshi count but no TP entered, so precision and recall cannot be calculated.',
            f'/videos/{no_tp[0]["id"]}', 1)
    no_sakshi = [r for r in rows if r["marks"] > 0 and not r["sakshi_entered"]]
    if no_sakshi:
        add("info", f'{len(no_sakshi)} video{"s have" if len(no_sakshi) != 1 else " has"} marks but no Sakshi result yet.', f'/videos/{no_sakshi[0]["id"]}', 0.5)
    if not rows:
        add("info", "No videos in this selection yet.", "/", 0)
    elif not any(r["tp"] is not None for r in rows) and not no_tp:
        add("info", "No TP has been entered yet, so there are no accuracy figures. Open a video and fill in the Accuracy report.", f'/videos/{rows[0]["id"]}', 0)

    order = {"bad": 0, "warn": 1, "info": 2}
    out.sort(key=lambda f: (order[f["severity"]], -f["_w"]))
    return [{k: v for k, v in f.items() if k != "_w"} for f in out[:MAX_FINDINGS]]
