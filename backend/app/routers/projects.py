from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user
from ..models import Project, User
from ..schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return db.scalars(select(Project).where(Project.owner_id == user.id).order_by(Project.id.desc())).all()


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = Project(name=body.name.strip(), owner_id=user.id)
    db.add(p)
    db.commit()
    return p
