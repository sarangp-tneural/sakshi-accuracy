import subprocess
from pathlib import Path

import pytest

from app import media, rtsp, worker
from app.models import Video
from tests.test_orphans import fake_media, fake, pid, recording, video  # noqa: F401  (fixtures and helpers)

SRC, DEST = Path("a.avi"), Path("out.mp4")
INFO = {"vcodec": "mpeg4", "container": "avi", "fps": 25.0, "duration_s": 100.0, "max_keyframe_gap_s": None}


class R:
    def __init__(self, rc=0, err=""):
        self.returncode, self.stderr, self.stdout = rc, err, ""


# ---- nothing may read the terminal: a background job that does is frozen by the operating system ----
def test_every_ffmpeg_command_refuses_stdin():
    for info in (INFO, {**INFO, "vcodec": "h264", "container": "mov,mp4", "max_keyframe_gap_s": 1.0}):
        assert "-nostdin" in media.build_playback_cmd(Path("a.mp4"), DEST, info)
    assert "-nostdin" in media.quick_copy_cmd(SRC, DEST)
    assert "-nostdin" in rtsp.build_ffmpeg_cmd("rtsp://h/x", 5, DEST)


def test_make_playback_never_inherits_the_terminal():
    seen = []
    media.make_playback(SRC, DEST, INFO, run=lambda cmd, **kw: (seen.append(kw), R())[1])
    assert seen and all(kw["stdin"] == subprocess.DEVNULL for kw in seen)


def test_probes_and_the_recorder_and_the_preview_never_inherit_the_terminal(monkeypatch, tmp_path):
    seen = []

    def fake_run(cmd, **kw):
        seen.append((cmd[0], kw.get("stdin")))
        return type("P", (), {"stdout": '{"streams":[{"codec_type":"video","codec_name":"h264","avg_frame_rate":"25/1"}],"format":{"duration":"1"}}',
                              "returncode": 0, "stderr": b""})()

    monkeypatch.setattr(subprocess, "run", fake_run)
    media.probe(tmp_path / "x.mp4")
    media.probe_keyframe_gap(tmp_path / "x.mp4")
    assert seen and all(cmd == "ffprobe" and stdin == subprocess.DEVNULL for cmd, stdin in seen)

    popen_kw = {}
    from tests.fakes import Clock, FakeProc
    c = Clock()
    rtsp.run_recording("rtsp://h/x", 1, tmp_path / "o.mp4", clock=c, sleep=c.sleep, wall=c.wall,
                       popen=lambda cmd, **kw: (popen_kw.update(kw), FakeProc(c, tmp_path / "o.mp4", data_for=None, exits_after=60))[1])
    assert popen_kw["stdin"] == subprocess.DEVNULL

    cap = {}
    with pytest.raises(RuntimeError):
        rtsp.grab_frame("rtsp://h/x", run=lambda cmd, **kw: (cap.update(kw), R(1))[1])
    assert cap["stdin"] == subprocess.DEVNULL


# ---- the conversion is bounded and falls back to a quick copy ----
def test_the_time_allowed_scales_with_the_video_but_is_never_unbounded():
    assert media.playback_timeout_s(None) == 600 and media.playback_timeout_s(0) == 600
    assert media.playback_timeout_s(1800) == 600 + 3600 and media.playback_timeout_s(-5) == 600


def test_a_normal_conversion_reports_ready():
    assert media.make_playback(SRC, DEST, INFO, run=lambda cmd, **kw: R()) == "ready"


def test_a_conversion_that_takes_too_long_falls_back_to_a_quick_copy():
    calls = []

    def run(cmd, **kw):
        calls.append(cmd)
        if len(calls) == 1:
            raise subprocess.TimeoutExpired(cmd, kw["timeout"])
        return R()

    assert media.make_playback(SRC, DEST, INFO, run=run) == "copied"
    assert "libx264" in calls[0] and "copy" in calls[1] and "libx264" not in calls[1]
    assert calls[0][calls[0].index("-nostdin") - 1] == "-y"


def test_if_even_the_quick_copy_fails_the_error_says_so():
    def run(cmd, **kw):
        if "libx264" in cmd:
            raise subprocess.TimeoutExpired(cmd, 1)
        return R(1, "cannot copy this codec")
    with pytest.raises(RuntimeError, match="took too long.*cannot copy"):
        media.make_playback(SRC, DEST, INFO, run=run)


def test_a_failed_conversion_still_raises():
    with pytest.raises(RuntimeError, match="boom"):
        media.make_playback(SRC, DEST, INFO, run=lambda cmd, **kw: R(1, "boom"))


# ---- "saving" is its own status ----
def test_the_row_says_processing_as_soon_as_the_recording_ends(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", file_bytes=100, tmp=tmp_path)
    seen = {}
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: {"status": "saved", "reason": None, "elapsed": 600})
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 10.0, "fps": 25.0, "vcodec": "h264", "width": 1, "height": 1,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})

    def spy(src, dest, info):
        v = video(vid)
        seen["status"], seen["ended"], seen["size"] = v.status, v.ended_at, v.file_size
        Path(dest).write_bytes(b"p")
        return "ready"

    monkeypatch.setattr(media, "make_playback", spy)
    worker.record_rtsp(vid)
    assert seen["status"] == "processing"  # the timer stops and the camera is free while the video is being prepared
    assert seen["ended"] is not None and seen["size"] == 100
    assert video(vid).status == "ready"


def test_a_partial_recording_keeps_its_reason_through_saving(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", file_bytes=100, tmp=tmp_path)
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: {"status": "partial", "reason": "Stream dropped after 20 s", "elapsed": 20})
    fake_media(monkeypatch)
    worker.record_rtsp(vid)
    v = video(vid)
    assert v.status == "partial" and v.status_reason == "Stream dropped after 20 s"


def test_the_quick_copy_fallback_is_noted_on_the_row(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", file_bytes=100, tmp=tmp_path)
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: {"status": "partial", "reason": "Stream dropped after 20 s", "elapsed": 20})
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 10.0, "fps": 25.0, "vcodec": "h264", "width": 1, "height": 1,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})
    monkeypatch.setattr(media, "make_playback", lambda src, dest, info: (Path(dest).write_bytes(b"p"), "copied")[1])
    worker.record_rtsp(vid)
    v = video(vid)
    assert v.status == "partial" and v.status_reason.startswith("Stream dropped after 20 s") and worker.COPY_NOTE in v.status_reason


def test_a_failed_conversion_marks_the_video_failed_with_the_reason(pid, fake, monkeypatch, tmp_path):
    vid = recording(pid, status="connecting", file_bytes=100, tmp=tmp_path)
    monkeypatch.setattr(rtsp, "run_recording", lambda *a, **k: {"status": "saved", "reason": None, "elapsed": 600})
    monkeypatch.setattr(media, "probe", lambda p: (_ for _ in ()).throw(ValueError("No video stream found")))
    worker.record_rtsp(vid)
    v = video(vid)
    assert v.status == "failed" and "No video stream found" in v.status_reason and not fake.data


def test_an_upload_gets_the_copy_note_too(pid, monkeypatch, tmp_path):
    vid = recording(pid, status="processing", file_bytes=100, tmp=tmp_path)
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 10.0, "fps": 25.0, "vcodec": "h264", "width": 1, "height": 1,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})
    monkeypatch.setattr(media, "make_playback", lambda src, dest, info: (Path(dest).write_bytes(b"p"), "copied")[1])
    worker.process_upload(vid)
    v = video(vid)
    assert v.status == "ready" and v.status_reason == worker.COPY_NOTE


def test_join_helper():
    assert worker._join(None, None) is None and worker._join("a", None) == "a" and worker._join("a", "b") == "a b" and worker._join("", "b") == "b"


def test_an_upload_is_timed_and_its_copy_size_stored(client, auth, pid, monkeypatch, tmp_path):
    monkeypatch.setattr(media, "probe", lambda p: {"duration_s": 10.0, "fps": 25.0, "vcodec": "h264", "width": 1, "height": 1,
                                                   "container": "mp4", "max_keyframe_gap_s": 1.0})
    monkeypatch.setattr(media, "make_playback", lambda src, dest, info: Path(dest).write_bytes(b"ppp") and "ready")
    r = client.post(f"/api/projects/{pid}/videos/upload", files={"file": ("a.mp4", b"x" * 100, "video/mp4")}, headers=auth)
    assert r.status_code == 201 and r.json()["queued_at"] and r.json()["converting_at"] is None  # waiting for the media worker
    worker.process_upload(r.json()["id"])
    v = video(r.json()["id"])
    assert v.status == "ready" and v.playback_size == 3 and v.file_size == 100
    assert v.queued_at <= v.converting_at <= v.converted_at
