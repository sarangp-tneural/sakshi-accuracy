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


class MarkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    video_id: int
    time_s: float
    direction: str
    gender: str
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
