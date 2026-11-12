import shutil

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from .. import control, liveness, worker
from ..config import settings
from ..db import get_db
from ..deps import current_user, get_project
from ..models import Camera, Mark, Project, SakshiResult, User, Video
from ..schemas import ProjectIn, ProjectOut
from ..sql import sakshi_has_value

router = APIRouter(prefix="/projects", tags=["projects"])


def with_summary(db: Session, projects: list[Project]) -> list[ProjectOut]:
    """ProjectOut with totals for the project cards: four grouped queries, however many projects there are."""
    outs = [ProjectOut.model_validate(p) for p in projects]
    if not outs:
        return outs
    by_id = {o.id: o for o in outs}
    ids = list(by_id)
    last: dict[int, list] = {i: [by_id[i].created_at] for i in ids}

    for pid, n, rec, conn, proc, failed, dur, newest in db.execute(
        select(Video.project_id, func.count(),
               func.count(case((Video.status == "recording", 1))), func.count(case((Video.status == "connecting", 1))),
               func.count(case((Video.status == "processing", 1))),
               func.count(case((Video.status == "failed", 1))), func.coalesce(func.sum(Video.duration_s), 0.0), func.max(Video.created_at))
        .where(Video.project_id.in_(ids)).group_by(Video.project_id)
    ):
        o = by_id[pid]
        o.video_count, o.recording_count, o.connecting_count = n, rec, conn
        o.processing_count, o.failed_count, o.total_duration_s = proc, failed, float(dur)
        last[pid].append(newest)

    for pid, n in db.execute(select(Camera.project_id, func.count()).where(Camera.project_id.in_(ids)).group_by(Camera.project_id)):
        by_id[pid].camera_count = n

    for pid, direction, n, newest in db.execute(
        select(Video.project_id, Mark.direction, func.count(), func.max(Mark.created_at))
        .join(Video, Video.id == Mark.video_id).where(Video.project_id.in_(ids)).group_by(Video.project_id, Mark.direction)
    ):
        o = by_id[pid]
        o.mark_total += n
        if direction == "in":
            o.mark_in += n
        else:
            o.mark_out += n
        last[pid].append(newest)

    for pid, n in db.execute(
        select(Video.project_id, func.count(Video.id)).join(SakshiResult, SakshiResult.video_id == Video.id)
        .where(Video.project_id.in_(ids), sakshi_has_value()).group_by(Video.project_id)
    ):
        by_id[pid].compared_count = n

    for pid, times in last.items():
        by_id[pid].last_activity_at = max(t for t in times if t is not None)
    return outs


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The user's projects with their totals, most recently active first."""
    projects = list(db.scalars(select(Project).where(Project.owner_id == user.id)).all())
    outs = with_summary(db, projects)
    return sorted(outs, key=lambda o: (o.last_activity_at, o.id), reverse=True)


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = Project(name=body.name.strip(), owner_id=user.id)
    db.add(p)
    db.commit()
    return with_summary(db, [p])[0]


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Remove a project with its videos, marks, results and cameras. Refused while something is still recording."""
    p = get_project(db, user, project_id)
    videos = list(db.scalars(select(Video).where(Video.project_id == p.id)).all())
    active = [v.id for v in videos if v.status in ("connecting", "recording")]
    if active:
        live = liveness.live_among(active, worker.celery)
        if live is None or live:
            raise HTTPException(409, "Cannot delete while a recording is running. Stop it first.")
        for vid in active:
            control.clear_stop(vid)
    ids = [v.id for v in videos]
    if ids:
        db.execute(delete(SakshiResult).where(SakshiResult.video_id.in_(ids)))
        db.execute(delete(Mark).where(Mark.video_id.in_(ids)))
        db.execute(delete(Video).where(Video.id.in_(ids)))
    db.execute(delete(Camera).where(Camera.project_id == p.id))
    db.delete(p)
    db.commit()
    for vid in ids:
        shutil.rmtree(settings.data_dir / "videos" / str(vid), ignore_errors=True)
