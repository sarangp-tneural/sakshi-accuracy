import os

os.environ["DATABASE_URL"] = "postgresql+psycopg://sakshi:sakshi@localhost:5442/sakshi_test"
os.environ["CELERY_EAGER"] = "true"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app import control, liveness, worker
from tests.fakeredis import FakeRedis
from app.config import settings
from app.db import Base, engine
from app.main import app
from app.models import User
from app.security import hash_password, make_token
from app.db import SessionLocal


@pytest.fixture(scope="session", autouse=True)
def _db():
    admin = create_engine(settings.database_url.rsplit("/", 1)[0] + "/postgres", isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        if not c.execute(text("select 1 from pg_database where datname='sakshi_test'")).scalar():
            c.execute(text("create database sakshi_test"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch):
    monkeypatch.setattr(control, "_client", FakeRedis())  # never the real Redis
    monkeypatch.setattr(settings, "data_dir", tmp_path / "data")
    # never run real ffmpeg tasks from API tests
    monkeypatch.setattr(worker, "enqueue", lambda task, vid: None)
    # API tests must not ask the real broker which workers are alive: by default every recording counts as live
    monkeypatch.setattr(liveness, "live_among", lambda ids, celery_app=None: set(ids))
    yield
    with engine.begin() as c:
        c.execute(text("truncate users, projects, videos, marks, marking_types, sakshi_results, user_settings restart identity cascade"))


@pytest.fixture
def client():
    return TestClient(app)


def make_user(email="a@x.com"):
    with SessionLocal() as db:
        u = User(email=email, password_hash=hash_password("pw"))
        db.add(u)
        db.commit()
        return u.id, {"Authorization": f"Bearer {make_token(u.id)}"}


@pytest.fixture
def auth():
    return make_user()[1]


@pytest.fixture
def video(client, auth):
    pid = client.post("/api/projects", json={"name": "p"}, headers=auth).json()["id"]
    from app.models import Video
    with SessionLocal() as db:
        v = Video(project_id=pid, name="v", source="upload", status="ready", duration_s=100)
        db.add(v)
        db.commit()
        return v.id
