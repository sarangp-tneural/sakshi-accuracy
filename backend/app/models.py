from datetime import datetime, timezone

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
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
    # "Find / Skip still moments" is offered on this project's videos only when this is on
    still_moments: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class MarkingType(Base):
    """One kind of mark a project can count (e.g. "Male IN", "Greeting"), with its own shortcut key.
    direction in/out adds to the IN/OUT totals; None is tracked on its own."""
    __tablename__ = "marking_types"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(60))
    direction: Mapped[str | None] = mapped_column(String(3), nullable=True)  # in | out | None
    key_code: Mapped[str] = mapped_column(String(20))
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # a type that already has marks is archived instead of deleted: hidden from counting, kept for old marks
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class Camera(Base):
    """A saved RTSP source of a project, so a recording is one click. The link is stored encrypted and never returned."""
    __tablename__ = "cameras"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    rtsp_url_enc: Mapped[str] = mapped_column(Text)
    rtsp_url_masked: Mapped[str] = mapped_column(Text)
    default_minutes: Mapped[int] = mapped_column(Integer, default=30)
    # virtual reference lines drawn on the view; copied into each video recorded from this camera
    lines: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    # focus area {x, y, w, h} (normalised 0..1) used to ignore changes elsewhere when skipping still moments; null = whole frame
    roi: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


# one name per project, ignoring case
Index("uq_cameras_project_name", Camera.project_id, func.lower(Camera.name), unique=True)


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
    # set when only the video FILE was deleted (to free disk space); the row, marks and results stay
    video_removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    camera_id: Mapped[int | None] = mapped_column(ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True, index=True)
    # when ffmpeg actually started / finished recording (created_at is when it was requested)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    file_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # bytes of the original
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vcodec: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # virtual reference lines (normalised 0..1); start as a copy of the camera's, then edited per video
    lines: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")
    # focus area {x, y, w, h} (normalised 0..1) used to ignore changes elsewhere when skipping still moments; null = whole frame
    roi: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    marks: Mapped[list["Mark"]] = relationship(cascade="all, delete-orphan", order_by="Mark.time_s")


class Mark(Base):
    __tablename__ = "marks"
    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("videos.id", ondelete="CASCADE"), index=True)
    time_s: Mapped[float] = mapped_column(Float)
    direction: Mapped[str | None] = mapped_column(String(3), nullable=True)  # in | out | None; copied from the type
    gender: Mapped[str] = mapped_column(String(7), default="unknown")  # deprecated, no longer used
    marking_type_id: Mapped[int | None] = mapped_column(ForeignKey("marking_types.id"), nullable=True, index=True)
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
    # {marking_type_id: count}; the four columns above only hold results saved before markings were configurable
    counts: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    # accuracy report inputs (see metrics.py): typed by hand now, filled by timestamp matching later
    tp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gender_assigned: Mapped[int | None] = mapped_column(Integer, nullable=True)
    real_male_in_tp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    real_female_in_tp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    correct_male: Mapped[int | None] = mapped_column(Integer, nullable=True)
    correct_female: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # same idea per marking: {marking_type_id: TP}
    tp_by_type: Mapped[dict | None] = mapped_column(JSON(none_as_null=True), nullable=True)
    tp_source: Mapped[str] = mapped_column(String(10), default="manual", server_default="manual")  # manual | matched
