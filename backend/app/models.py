from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class UserSettings(Base):
    __tablename__ = "user_settings"
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    reaction_delay_s: Mapped[float] = mapped_column(Float, default=0.4)
    sound_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    slow_after_jump: Mapped[bool] = mapped_column(Boolean, default=False)
    key_bindings: Mapped[dict] = mapped_column(JSON, default=dict)


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    playback_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(10))  # upload | rtsp
    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(15))  # processing|ready|recording|partial|failed
    status_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rtsp_url_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    rtsp_url_masked: Mapped[str | None] = mapped_column(Text, nullable=True)
    rtsp_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    marks: Mapped[list["Mark"]] = relationship(cascade="all, delete-orphan", order_by="Mark.time_s")


class Mark(Base):
    __tablename__ = "marks"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    time_s: Mapped[float] = mapped_column(Float)
    direction: Mapped[str] = mapped_column(String(3))  # in | out
    gender: Mapped[str] = mapped_column(String(7))  # male | female | unknown
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    # where on the picture (normalised 0..1 of the video frame); both null or both set
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    # extension point for later: person crop / box
    extra: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class SakshiResult(Base):
    __tablename__ = "sakshi_results"
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True)
    in_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    out_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    male_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    female_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
