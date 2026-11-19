from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    token: str


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectPatch(BaseModel):
    still_moments: bool | None = None
    keep_format: bool | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    still_moments: bool = False  # Find / Skip still moments is offered on this project's videos
    keep_format: bool = True  # videos keep the stream's own format (no conversion)
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


class Roi(BaseModel):
    """The focus area, in normalised 0..1 frame coordinates."""
    x: Unit
    y: Unit
    w: Annotated[float, Field(gt=0.02, le=1)]
    h: Annotated[float, Field(gt=0.02, le=1)]

    @model_validator(mode="after")
    def _inside(self):
        if self.x + self.w > 1.0001 or self.y + self.h > 1.0001:
            raise ValueError("The focus area must stay inside the picture")
        return self


class RoiIn(BaseModel):
    roi: Roi | None = None  # null = the whole frame


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
    playback_size: int | None = None
    playback_vcodec: str | None = None
    playback_width: int | None = None
    playback_height: int | None = None
    playback_fps: float | None = None
    picked_up_at: datetime | None = None
    queued_at: datetime | None = None
    converting_at: datetime | None = None
    converted_at: datetime | None = None
    width: int | None = None
    height: int | None = None
    vcodec: str | None = None
    # filled by the list/get endpoints
    mark_total: int = 0
    mark_in: int = 0
    mark_out: int = 0
    mark_types: dict[str, int] = {}  # marks per marking type id
    sakshi_entered: bool = False
    camera_id: int | None = None
    camera_name: str | None = None
    video_removed_at: datetime | None = None  # the video file was deleted to free space; everything else stays
    disk_bytes: int | None = None  # what the video files take on disk now (None once removed or if there are none)
    lines: list[VirtualLine] = []
    roi: Roi | None = None


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
    roi: Roi | None = None
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
KeyCode = Annotated[str, Field(min_length=1, max_length=20)]
HexColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


class MarkingTypeIn(BaseModel):
    label: str = Field(min_length=1, max_length=60)
    direction: Direction | None = None  # None: tracked on its own, not part of the IN/OUT totals
    key_code: KeyCode
    color: HexColor | None = None


class MarkingTypePatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=60)
    direction: Direction | None = None
    key_code: KeyCode | None = None
    color: HexColor | None = None


class MarkingTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    project_id: int
    label: str
    direction: str | None
    key_code: str
    color: str | None
    sort_order: int
    archived: bool
    mark_count: int = 0


class MarkingOrderIn(BaseModel):
    ids: list[int]


class MarkIn(BaseModel):
    time_s: float = Field(ge=0)
    marking_type_id: int


class MarkPatch(BaseModel):
    time_s: float | None = Field(default=None, ge=0)
    marking_type_id: int | None = None


class PointIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class MarkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    video_id: int
    time_s: float
    direction: str | None
    marking_type_id: int | None
    x: float | None = None
    y: float | None = None
    created_at: datetime


class SakshiIO(BaseModel):
    """What Sakshi counted, one number per marking type id (leave a type out for "not entered")."""
    counts: dict[int, Annotated[int, Field(ge=0)]] = {}
    # read-only: results saved before markings were configurable
    legacy: dict[str, int] | None = None


EvalInt = Annotated[int, Field(ge=0, le=1_000_000)]


class EvaluationIn(BaseModel):
    """Numbers only you can know (blank = not entered). tp: system counts that were real visitors."""
    tp: EvalInt | None = None
    gender_assigned: EvalInt | None = None
    real_male_in_tp: EvalInt | None = None
    real_female_in_tp: EvalInt | None = None
    correct_male: EvalInt | None = None
    correct_female: EvalInt | None = None
    type_tp: dict[int, EvalInt] = {}  # TP per marking type id (a marking left out = not entered)


class MarkingEval(BaseModel):
    id: int
    label: str
    direction: str | None
    archived: bool
    metrics: dict


class EvaluationOut(BaseModel):
    inputs: EvaluationIn
    tp_source: str = "manual"
    metrics: dict
    types: list[MarkingEval] = []
    problems: list[str] = []  # the saved numbers no longer add up (e.g. marks were changed afterwards)


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
