import signal
from datetime import timedelta

import pytest

from app import rtsp
from app.config import settings
from tests.fakes import DEAD, HANGS, T0, URL, FakeProc, healthy, record


@pytest.fixture(autouse=True)
def timing(monkeypatch):
    monkeypatch.setattr(settings, "rtsp_min_footage_bytes", 1000)
    monkeypatch.setattr(settings, "rtsp_attempt_window_s", 300)
    monkeypatch.setattr(settings, "rtsp_attempt_retry_s", 10)
    monkeypatch.setattr(settings, "rtsp_attempt_try_s", 25)
    monkeypatch.setattr(settings, "rtsp_stall_s", 45)


def at(seconds):
    return T0 + timedelta(seconds=seconds)


# ------------------------------------------------------------------ attempting
def test_a_camera_that_is_online_records_from_the_start(tmp_path):
    res, events, c, procs = record(tmp_path, [healthy(1)])
    assert res["status"] == "saved" and res["attempts"] == 1 and res["started_at"] == at(0)
    assert [e[0] for e in events] == ["attempt", "connected"]
    assert res["ended_at"] == at(60) and res["elapsed"] == pytest.approx(60, abs=1)


def test_it_keeps_attempting_and_the_start_time_is_when_video_arrives(tmp_path):
    # two tries on a camera that is still booting (10 s each, 10 s between), the third finds video
    res, events, c, procs = record(tmp_path, [DEAD, DEAD, healthy(1)])
    assert res["status"] == "saved" and res["attempts"] == 3
    assert res["started_at"] == at(40)  # the moment the feed came, not when Start was pressed
    assert res["ended_at"] == at(100)  # and the minute of video counts from there
    attempts = [e for e in events if e[0] == "attempt"]
    assert [a[1] for a in attempts] == [1, 2, 3]
    assert attempts[0][2] == "" and "Could not reach the camera" in attempts[1][2]  # each try says why the last one failed
    assert events[-1] == ("connected", at(40), 40)


def test_the_camera_coming_online_late_in_the_window_still_records(tmp_path):
    plans = [DEAD] * 14 + [healthy(1)]  # the 15th try (t=280) succeeds, 20 s before the window closes
    res, events, c, procs = record(tmp_path, plans)
    assert res["status"] == "saved" and res["attempts"] == 15 and res["started_at"] == at(280)


def test_it_gives_up_after_the_window_with_a_plain_reason(tmp_path):
    res, events, c, procs = record(tmp_path, [DEAD])
    assert res["status"] == "failed" and res["started_at"] is None  # it never started recording
    assert res["attempts"] == 15 and "15 attempts" in res["reason"] and "within 5 min" in res["reason"]
    assert "Could not reach the camera" in res["reason"] and "Tailscale" in res["reason"]
    assert res["ended_at"] == at(300)
    assert not any(e[0] == "connected" for e in events)
    assert c.t == 300  # it did not start a try after the window closed


def test_a_try_that_hangs_without_video_is_given_up_and_retried(tmp_path):
    res, events, c, procs = record(tmp_path, [HANGS, HANGS, healthy(1)])
    assert res["status"] == "saved" and res["attempts"] == 3
    assert all(p.signals for p in procs[:2])  # the stuck ones were told to stop
    assert res["started_at"] == at(2 * (25 + 1 + 10))  # each stuck try is abandoned after ~25 s, then 10 s before the next
    assert "no video within 25 s" in [e for e in events if e[0] == "attempt"][1][2]


def test_a_file_with_only_a_header_is_not_a_connection(tmp_path):
    class HeaderOnly(FakeProc):
        def __init__(self, clock, out, **kw):
            super().__init__(clock, out, data_for=0, exits_after=3, rc=1, err="Invalid data found")
            out.write_bytes(b"x" * 500)  # less than the footage threshold
    c_plans = {"n": 0}
    res, events, c, procs = record(tmp_path, [DEAD], minutes=1)  # sanity: nothing connected without footage
    assert res["status"] == "failed"
    # now with header-only processes
    import tests.fakes as fakes
    original = fakes.FakeProc
    try:
        fakes.FakeProc = HeaderOnly
        res, events, c, procs = fakes.record(tmp_path, [{}])
    finally:
        fakes.FakeProc = original
    assert res["status"] == "failed" and res["started_at"] is None and not any(e[0] == "connected" for e in events)


def test_stop_while_attempting_cancels_it(tmp_path):
    res, events, c, procs = record(tmp_path, [HANGS], stop_at=5)
    assert res["status"] == "failed" and res["reason"] == "Cancelled before the camera connected." and res["started_at"] is None
    assert procs[0].signals  # the try in progress was ended
    assert not (tmp_path / "o.mp4").exists()


def test_stop_between_tries_also_cancels(tmp_path):
    res, events, c, procs = record(tmp_path, [DEAD], stop_at=15)  # during the wait after the first failed try
    assert res["status"] == "failed" and res["reason"] == "Cancelled before the camera connected." and len(procs) == 1


# ------------------------------------------------------------------ feed lost / stopped
def test_feed_lost_ends_the_recording_at_the_last_moment_video_arrived(tmp_path):
    # video for 30 s, then the connection resets and ffmpeg exits 2 s later
    res, events, c, procs = record(tmp_path, [dict(data_for=30, exits_after=32, rc=1, err="Connection reset by peer")], minutes=5)
    assert res["status"] == "partial" and res["started_at"] == at(0)
    assert res["ended_at"] == at(29)  # the last time the file grew, not when we noticed
    assert "stopped sending video at" in res["reason"] and "connection was lost" in res["reason"]
    assert at(29).astimezone().strftime("%H:%M:%S") in res["reason"]
    assert "Could not reach" not in res["reason"] and "Connection reset" not in res["reason"]  # no attempt-phase wording, no raw ffmpeg noise


def test_a_silent_camera_ends_when_video_last_arrived_not_after_the_watchdog(tmp_path):
    res, events, c, procs = record(tmp_path, [dict(data_for=10, exits_after=None)], minutes=30)  # sits on a dead socket
    assert res["status"] == "partial" and res["ended_at"] == at(9)
    assert "nothing new for 45 s" in res["reason"] and "camera still online" in res["reason"]
    assert c.t >= 10 + 45  # it took the watchdog's 45 s to notice, but the recording's end time is when the video stopped


def test_after_a_late_connection_the_loss_time_is_relative_to_the_real_clock(tmp_path):
    res, events, c, procs = record(tmp_path, [DEAD, dict(data_for=20, exits_after=21, rc=1)], minutes=5)
    assert res["started_at"] == at(20) and res["ended_at"] == at(20 + 19)


def test_a_stalled_ffmpeg_that_ignores_sigint_is_still_ended(tmp_path):
    res, events, c, procs = record(tmp_path, [dict(data_for=5, exits_after=None, ignores_sigint=True)], minutes=30)
    assert res["status"] == "partial" and signal.SIGINT in procs[0].signals and signal.SIGTERM in procs[0].signals


def test_manual_stop_while_recording_ends_at_the_stop_moment(tmp_path):
    res, events, c, procs = record(tmp_path, [healthy(30)], minutes=30, stop_at=125)
    assert res["status"] == "stopped" and res["started_at"] == at(0)
    assert "Stopped manually after 125 s" in res["reason"]
    assert res["ended_at"] >= at(125)  # the moment of the stop (plus the time ffmpeg took to finish), not an earlier moment


def test_stop_without_any_footage_is_failed(tmp_path):
    # connected for the threshold check, then the file is removed: nothing usable
    res, events, c, procs = record(tmp_path, [healthy(30)], minutes=30, stop_at=3)
    (tmp_path / "o.mp4").unlink()
    assert res["status"] == "stopped"  # footage existed when it stopped


def test_a_process_that_overruns_its_time_is_killed(tmp_path):
    res, events, c, procs = record(tmp_path, [dict(data_for=None, exits_after=None)], minutes=1)
    assert res["status"] == "partial" and "overran" in res["reason"] and procs[0].killed


def test_a_healthy_recording_is_not_mistaken_for_a_stall(tmp_path):
    res, events, c, procs = record(tmp_path, [healthy(5)], minutes=5)
    assert res["status"] == "saved" and res["ended_at"] == at(300)


def test_recording_stops_early_by_itself_is_partial_with_the_last_data_time(tmp_path):
    res, events, c, procs = record(tmp_path, [dict(data_for=20, exits_after=20, rc=1, err="Connection refused")], minutes=5)
    assert res["status"] == "partial" and res["ended_at"] == at(19)


# ------------------------------------------------------------------ plumbing
def test_the_heartbeat_ticks_every_second_through_attempts_and_recording(tmp_path):
    ticks = []
    from tests.fakes import Clock
    c, out, n = Clock(), tmp_path / "o.mp4", [0]
    plans = [DEAD, healthy(1)]

    def popen(cmd, **kw):
        n[0] += 1
        return FakeProc(c, out, **plans[min(n[0] - 1, 1)])

    rtsp.run_recording(URL, 1, out, clock=c, sleep=c.sleep, popen=popen, wall=c.wall, on_tick=lambda: ticks.append(c.t))
    gaps = [b - a for a, b in zip(ticks, ticks[1:])]
    assert ticks[0] == 0 and ticks[-1] >= 79 and max(gaps) <= 1 and min(gaps) >= 0  # never a silent second, including the waits between tries


def test_an_old_partial_file_from_a_failed_try_is_removed_before_the_next_try(tmp_path):
    out = tmp_path / "o.mp4"
    out.write_bytes(b"leftover" * 1000)
    res, events, c, procs = record(tmp_path, [DEAD, healthy(1)])
    assert res["status"] == "saved"  # the leftover did not count as an instant connection
    assert res["started_at"] == at(20)


def test_credentials_never_appear_in_reasons(tmp_path):
    res, *_ = record(tmp_path, [dict(DEAD, err=f"error opening {URL} (password s3cret)")])
    assert "s3cret" not in res["reason"] and "admin" not in res["reason"]


def test_ffmpeg_gets_a_network_timeout_and_no_terminal():
    cmd = rtsp.build_ffmpeg_cmd(URL, 5, __import__("pathlib").Path("o.mp4"))
    assert cmd[cmd.index("-timeout") + 1] == str(settings.rtsp_io_timeout_s * 1_000_000) and cmd.index("-timeout") < cmd.index("-i")
    assert "-nostdin" in cmd
