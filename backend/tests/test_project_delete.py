from app.db import SessionLocal
from app.models import Camera, Mark, Project, Video
from tests.conftest import make_user


def test_delete_project_removes_everything(client, auth):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    with SessionLocal() as db:
        v = Video(project_id=pid, name="v", source="upload", status="ready")
        db.add(v)
        db.flush()
        db.add(Mark(video_id=v.id, time_s=1.0, direction="in", gender="male", created_by=1))
        db.commit()
    assert client.delete(f"/api/projects/{pid}", headers=auth).status_code == 204
    with SessionLocal() as db:
        assert db.get(Project, pid) is None
        assert db.query(Video).count() == 0 and db.query(Mark).count() == 0 and db.query(Camera).count() == 0
    assert client.delete(f"/api/projects/{pid}", headers=auth).status_code == 404
