from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    token: str


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    created_at: datetime
    # filled in by the list endpoint (zeros for a project that was just created)
    video_count: int = 0
    recording_count: int = 0
    connecting_count: int = 0  # recordings still attempting to connect
    processing_count: int = 0
    failed_count: int = 0
    camera_count: int = 0
    mark_total: int = 0
    mark_in: int = 0
    mark_out: int = 0
    compared_count: int = 0  # videos with a Sakshi result entered
    total_duration_s: float = 0.0
    last_activity_at: datetime | None = None  # newest of: project created, video added, mark counted


MAX_LINES = 20
Unit = Annotated[float, Field(ge=0, le=1)]


class VirtualLine(BaseModel):
    """A reference line on the picture, in normalised 0..1 frame coordinates."""
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=40)
    x1: Unit
    y1: Unit
    x2: Unit
    y2: Unit
    color: str = Field(default="#ffcc00", pattern=r"^#[0-9a-fA-F]{6}$")


class LinesIn(BaseModel):
    lines: list[VirtualLine] = Field(max_length=MAX_LINES)


class VideoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    name: str
    source: str
    status: str
    status_reason: str | None
    duration_s: float | None
    fps: float | None
    rtsp_url_masked: str | None
    rtsp_minutes: int | None
    created_at: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    file_size: int | None = None
    width: int | None = None
    height: int | None = None
    vcodec: str | None = None
    # filled by the list/get endpoints
    mark_total: int = 0
    mark_in: int = 0
    mark_out: int = 0
    mark_male: int = 0
    mark_female: int = 0
    mark_unknown: int = 0
    sakshi_entered: bool = False
    camera_id: int | None = None
    camera_name: str | None = None
    video_removed_at: datetime | None = None  # the video file was deleted to free space; everything else stays
    disk_bytes: int | None = None  # what the video files take on disk now (None once removed or if there are none)
    lines: list[VirtualLine] = []


class VideoFileRemovedOut(BaseModel):
    video: VideoOut
    freed_bytes: int


class VideoListOut(BaseModel):
    items: list[VideoOut]
    total: int  # all videos matching the filters (not just this page)
    page: int
    page_size: int
    status_counts: dict[str, int]  # per status under every active filter except the status filter itself, plus "all"
    busy: bool  # any video of the project is recording or processing (ignores filters)


class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    url: str = Field(max_length=2000)
    default_minutes: int = 30


class CameraPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    url: str | None = Field(default=None, max_length=2000)  # leave out to keep the saved link
    default_minutes: int | None = None


class CameraOut(BaseModel):
    id: int
    project_id: int
    name: str
    rtsp_url_masked: str  # the real link is never returned
    default_minutes: int
    created_at: datetime
    lines: list[VirtualLine] = []
    last_recorded_at: datetime | None = None
    recording_video_id: int | None = None  # the recording (or attempt) in progress, if any
    recording_status: str | None = None  # "connecting" (attempting) or "recording"
    recording_note: str | None = None  # while attempting: the latest try and why it failed
    recording_started_at: datetime | None = None
    recording_created_at: datetime | None = None
    recording_minutes: int | None = None


class RecordCameraIn(BaseModel):
    minutes: int | None = None  # default: the camera's saved length


class RtspIn(BaseModel):
    url: str = Field(max_length=2000)
    minutes: int
    name: str | None = Field(default=None, max_length=255)


class RtspPreviewIn(BaseModel):
    url: str = Field(max_length=2000)


Direction = Literal["in", "out"]
Gender = Literal["male", "female", "unknown"]


class MarkIn(BaseModel):
    time_s: float = Field(ge=0)
    direction: Direction
    gender: Gender


class MarkPatch(BaseModel):
    time_s: float | None = Field(default=None, ge=0)
    direction: Direction | None = None
    gender: Gender | None = None


class PointIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class MarkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    video_id: int
    time_s: float
    direction: str
    gender: str
    x: float | None = None
    y: float | None = None
    created_at: datetime


class SakshiIO(BaseModel):
    in_count: int | None = Field(default=None, ge=0)
    out_count: int | None = Field(default=None, ge=0)
    male_count: int | None = Field(default=None, ge=0)
    female_count: int | None = Field(default=None, ge=0)


class SettingsOut(BaseModel):
    reaction_delay_s: float
    sound_enabled: bool
    slow_after_jump: bool
    key_bindings: dict[str, str]


class SettingsIn(BaseModel):
    reaction_delay_s: float = Field(ge=0, le=3)
    sound_enabled: bool
    slow_after_jump: bool
    key_bindings: dict
