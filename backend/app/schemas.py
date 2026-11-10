from datetime import datetime
from typing import Literal

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
    last_recorded_at: datetime | None = None
    recording_video_id: int | None = None  # the recording in progress, if any
    recording_started_at: datetime | None = None
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
