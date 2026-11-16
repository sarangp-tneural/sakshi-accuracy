from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import control, dashboard as dash, liveness, relay, storage, worker
from ..config import settings
from ..db import get_db
from ..deps import current_user, get_project
from ..models import Camera, Mark, Project, User, Video

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
MAX_VIDEOS = 500
ACTIVE = ("connecting", "recording")


def _project_ids(db: Session, user: User, project_id: int | None) -> list[int]:
    if project_id is not None:
        return [get_project(db, user, project_id).id]  # 404 when it is not the user's
    return list(db.scalars(select(Project.id).where(Project.owner_id == user.id).order_by(Project.id)))


@router.get("")
def get_dashboard(project_id: int | None = None, days: int = Query(30, ge=0, le=3650),
                  group: Literal["project", "camera"] = "project",
                  db: Session = Depends(get_db), user: User = Depends(current_user)):
    """One payload for the dashboard. days=0 means all time. Only the user's own projects are ever included."""
    pids = _project_ids(db, user, project_id)
    since = datetime.now(timezone.utc) - timedelta(days=days) if days else None
    rows = dash.evaluation_rows(db, pids, since)
    groups = dash.group_rows(rows, group)
    markings = dash.marking_totals(rows)
    ids = [r["id"] for r in rows]
    marks_per_day: list[dict] = []
    if ids:
        marks_per_day = [{"date": str(d), "marks": n} for d, n in db.execute(
            select(func.date(Mark.created_at), func.count()).where(Mark.video_id.in_(ids)).group_by(func.date(Mark.created_at)).order_by(func.date(Mark.created_at)))]
    status_counts: dict[str, int] = {}
    for r in rows:
        status_counts[r["status"]] = status_counts.get(r["status"], 0) + 1
    projects = [{"id": p.id, "name": p.name} for p in db.scalars(select(Project).where(Project.owner_id == user.id).order_by(func.lower(Project.name)))]
    shown = rows[:MAX_VIDEOS]
    return {
        "filters": {"project_id": project_id, "days": days, "group": group},
        "projects": projects,
        "cards": dash.cards(rows),
        "findings": dash.findings(rows, groups, markings),
        "groups": groups,
        "markings": markings,
        "trend": dash.trend(rows),
        "activity": {"marks_per_day": marks_per_day, "videos_per_day": [{"date": t["date"], "videos": t["videos"]} for t in dash.trend(rows)],
                     "funnel": dash.funnel(rows)},
        "status_counts": status_counts,
        "videos": [{k: v for k, v in r.items() if k not in ("types",)} for r in shown],
        "truncated": len(rows) > MAX_VIDEOS,
    }


def _check(fn) -> dict:
    """Run one health check; a check that fails reports 'down' with a reason instead of failing the page."""
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        return {"state": "down", "note": str(e)[:160]}


def _redis() -> dict:
    control._r().ping()
    return {"state": "up"}


def _relay() -> dict:
    if not settings.rtsp_relay:
        return {"state": "off", "note": "RTSP_RELAY=false: cameras are read directly"}
    relay._call("GET", "/v3/paths/list", timeout=1.5)
    return {"state": "up"}


def _disk() -> dict:
    free = storage.free_bytes()
    low = free < settings.min_free_disk_bytes * 2
    return {"state": "warn" if low else "up", "free_bytes": free, "min_free_bytes": settings.min_free_disk_bytes,
            "videos_bytes": storage.dir_size(settings.data_dir / "videos"),
            "note": "Free space is getting close to the limit where recording stops" if low else None}


@router.get("/health")
def get_health(project_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Recordings, cameras and the services the app depends on. Each check is isolated: one failing never breaks the rest."""
    pids = _project_ids(db, user, project_id)
    active = list(db.execute(select(Video.id, Video.name, Video.status).where(Video.project_id.in_(pids), Video.status.in_(ACTIVE))))
    live = liveness.live_among([a.id for a in active], worker.celery) if active else set()
    week = datetime.now(timezone.utc) - timedelta(days=7)
    counts = {st: n for st, n in db.execute(select(Video.status, func.count()).where(Video.project_id.in_(pids)).group_by(Video.status))}
    failed_week = db.scalar(select(func.count()).select_from(Video).where(Video.project_id.in_(pids), Video.status == "failed", Video.created_at >= week))
    stuck = [] if live is None else [{"id": a.id, "name": a.name} for a in active if a.id not in live]
    cams = list(db.scalars(select(Camera).where(Camera.project_id.in_(pids))))
    cam_ids = [c.id for c in cams]
    last_status: dict[int, str] = {}
    recording_cams: set[int] = set()
    if cam_ids:
        newest = select(func.max(Video.id)).where(Video.camera_id.in_(cam_ids)).group_by(Video.camera_id)
        last_status = {cid: st for cid, st in db.execute(select(Video.camera_id, Video.status).where(Video.id.in_(newest)))}
        recording_cams = set(db.scalars(select(Video.camera_id).where(Video.camera_id.in_(cam_ids), Video.status.in_(ACTIVE))))
    problems = [{"id": v.id, "name": v.name, "status": v.status, "reason": (v.status_reason or "")[:200], "when": v.created_at}
                for v in db.scalars(select(Video).where(Video.project_id.in_(pids), Video.status.in_(("failed", "partial")))
                                    .order_by(Video.id.desc()).limit(8))]
    return {
        "recordings": {"active": len(active), "processing": counts.get("processing", 0), "failed_7d": failed_week,
                       "stuck": stuck, "stuck_unknown": live is None},
        "cameras": {"total": len(cams), "recording": len(recording_cams),
                    "never_recorded": sum(1 for c in cams if c.id not in last_status),
                    "last_failed": [{"id": c.id, "name": c.name} for c in cams if last_status.get(c.id) == "failed"]},
        "services": {"disk": _check(_disk), "redis": _check(_redis), "relay": _check(_relay)},
        "problems": problems,
        "checked_at": datetime.now(timezone.utc),
    }
