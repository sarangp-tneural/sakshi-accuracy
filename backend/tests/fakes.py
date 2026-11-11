"""A simulated clock and ffmpeg, so recorder behaviour over minutes of 'time' is tested in milliseconds."""
import io
import signal
import subprocess
from datetime import datetime, timedelta, timezone

from app import rtsp

URL = "rtsp://admin:s3cret@10.0.0.5:554/stream1?key=abc"
T0 = datetime(2026, 11, 10, 12, 0, 0, tzinfo=timezone.utc)


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s

    def wall(self):
        return T0 + timedelta(seconds=self.t)


class FakeProc:
    """One ffmpeg process. All times are seconds after it started.
    data_for:    video flows (the output file grows 1000 B per poll) for this long; 0 = never; None = for ever
    exits_after: the process ends by itself after this long (None = never, like ffmpeg stuck on a dead socket)"""

    def __init__(self, clock, out, *, data_for=0, exits_after=None, rc=0, err="", ignores_sigint=False):
        self.clock, self.out, self.born = clock, out, clock.t
        self.data_until = None if data_for is None else self.born + data_for
        self.has_data = data_for != 0
        self.exits_at = None if exits_after is None else self.born + exits_after
        self.rc_final, self.returncode, self.killed, self.signals = rc, None, False, []
        self.ignores_sigint = ignores_sigint
        self.stderr = io.StringIO(err)
        if self.has_data:
            out.write_bytes(b"x" * 1000)  # the file appears with the first fragment

    def poll(self):
        if self.killed:
            self.returncode = -9
        elif self.exits_at is not None and self.clock.t >= self.exits_at:
            self.returncode = self.rc_final
        if self.returncode is not None:
            return self.returncode
        if self.has_data and (self.data_until is None or self.clock.t < self.data_until):
            with self.out.open("ab") as f:
                f.write(b"x" * 1000)
        return None

    def send_signal(self, sig):
        self.signals.append(sig)
        if not (self.ignores_sigint and sig == signal.SIGINT):
            self.exits_at, self.rc_final = self.clock.t, 255  # finalizes the file and exits

    def wait(self, timeout=None):
        self.poll()
        if self.returncode is not None:
            return self.returncode
        raise subprocess.TimeoutExpired("ffmpeg", timeout)

    def kill(self):
        self.killed = True


# ready-made behaviours of one attempt
DEAD = dict(data_for=0, exits_after=10, rc=1, err="Connection to tcp://h:554?timeout=10000000 failed: Connection timed out")
HANGS = dict(data_for=0, exits_after=None)


def healthy(minutes=1):
    return dict(data_for=None, exits_after=minutes * 60, rc=0)


def record(tmp_path, plans, *, minutes=1, stop_at=None):
    """Run the recorder with attempt n behaving like plans[n] (the last plan repeats). Returns (result, events, clock, procs)."""
    c, out, procs, events = Clock(), tmp_path / "o.mp4", [], []

    def popen(cmd, **kw):
        procs.append(FakeProc(c, out, **plans[min(len(procs), len(plans) - 1)]))
        return procs[-1]

    res = rtsp.run_recording(
        URL, minutes, out, clock=c, sleep=c.sleep, popen=popen, wall=c.wall,
        should_stop=lambda: stop_at is not None and c.t >= stop_at,
        on_attempt=lambda n, e: events.append(("attempt", n, e, c.t)),
        on_connected=lambda when: events.append(("connected", when, c.t)),
    )
    return res, events, c, procs
