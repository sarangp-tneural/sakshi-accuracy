import { describe, expect, it } from "vitest";
import type { Video } from "../api";
import { fmtBytes, fmtDateTime, fmtStream } from "./format";
import { videoDetails } from "./videoDetails";

const base: Video = {
  id: 1, project_id: 1, name: "cam", source: "upload", status: "ready", status_reason: null, duration_s: 127.8, fps: 25,
  rtsp_url_masked: null, rtsp_minutes: null, created_at: "2026-11-10T12:47:31Z", started_at: null, ended_at: null,
  file_size: 40_500_000, width: 1920, height: 1080, vcodec: "h264",
  mark_total: 0, mark_in: 0, mark_out: 0, mark_male: 0, mark_female: 0, mark_unknown: 0, sakshi_entered: false, camera_id: null, camera_name: null,
};
const rtsp = (o: Partial<Video> = {}): Video => ({ ...base, source: "rtsp", rtsp_url_masked: "rtsp://***:***@10.0.0.5:554/ch1", rtsp_minutes: 5,
  started_at: "2026-11-10T12:00:00Z", ended_at: "2026-11-10T12:05:00Z", duration_s: 300, ...o });
const get = (d: ReturnType<typeof videoDetails>, label: string) => d.find((x) => x.label === label);

describe("formatters", () => {
  it("fmtBytes", () => {
    expect(fmtBytes(null)).toBe("—");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(40_500_000)).toBe("38.6 MB");
    expect(fmtBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(fmtBytes(300 * 1024 ** 2)).toBe("300 MB");
  });
  it("fmtStream uses what is known", () => {
    expect(fmtStream(1920, 1080, 25, "h264")).toBe("1920×1080 · 25 fps · H.264");
    expect(fmtStream(null, null, 29.97, null)).toBe("29.97 fps".replace("29.97", "30.0"));
    expect(fmtStream(null, null, null, null)).toBe("—");
    expect(fmtStream(640, 360, null, "weird")).toBe("640×360 · WEIRD");
  });
  it("fmtDateTime handles missing and invalid", () => { expect(fmtDateTime(null)).toBe("—"); expect(fmtDateTime("nope")).toBe("—"); expect(fmtDateTime("2026-11-10T12:00:00Z")).not.toBe("—"); });
});

describe("videoDetails: uploads", () => {
  it("shows upload time, duration, stream, size, marks and Sakshi", () => {
    const d = videoDetails(base, 0);
    expect(get(d, "Uploaded")).toBeTruthy();
    expect(get(d, "Duration")?.value).toBe("02:07.8");
    expect(get(d, "Video")?.value).toBe("1920×1080 · 25 fps · H.264");
    expect(get(d, "File size")?.value).toBe("38.6 MB");
    expect(get(d, "Marks")).toMatchObject({ value: "none yet", tone: "muted" });
    expect(get(d, "Gender")).toBeUndefined();
    expect(get(d, "Sakshi result")).toMatchObject({ value: "not entered", tone: "muted" });
    expect(get(d, "Stream")).toBeUndefined();
  });
  it("shows mark and gender totals, including unknown", () => {
    const d = videoDetails({ ...base, mark_total: 10, mark_in: 6, mark_out: 4, mark_male: 3, mark_female: 5, mark_unknown: 2, sakshi_entered: true }, 0);
    expect(get(d, "Marks")?.value).toBe("10 · ▲ IN 6 · ▼ OUT 4");
    expect(get(d, "Gender")?.value).toBe("♂ 3 · ♀ 5 · ? 2");
    expect(get(d, "Sakshi result")).toMatchObject({ value: "entered", tone: "good" });
  });
});

describe("videoDetails: attempting and never-started recordings", () => {
  const attempting = (o: Partial<Video> = {}): Video => rtsp({ status: "connecting", started_at: null, ended_at: null, duration_s: null, file_size: null, width: null, height: null, vcodec: null,
    created_at: "2026-11-10T12:00:00Z", status_reason: "Attempt 3 · The camera refused the connection.", ...o });
  const now = new Date("2026-11-10T12:01:05Z").getTime();
  it("an attempting row shows how long, which try, and the latest reason; no start time yet", () => {
    const d = videoDetails(attempting(), now);
    expect(get(d, "Recording started")).toMatchObject({ value: "not yet: still attempting to connect", tone: "muted" });
    expect(get(d, "Attempting for")?.value).toBe("01:05");
    expect(get(d, "Attempt")?.value).toBe("try 3");
    expect(get(d, "Latest attempt")).toMatchObject({ value: "The camera refused the connection.", wide: true, tone: "warn" });
    expect(get(d, "Recorded so far")).toBeUndefined();
    expect(get(d, "Why it failed")).toBeUndefined();
  });
  it("an attempt nobody picked up says the recorder is not working on it", () => {
    const d = videoDetails(attempting({ status_reason: null }), now);
    expect(get(d, "Attempt")).toMatchObject({ value: "waiting for the recorder…", tone: "warn" });
    expect(get(videoDetails(attempting({ status_reason: null }), new Date("2026-11-10T12:00:05Z").getTime()), "Attempt")?.value).toBe("starting…");
  });
  it("a failed attempt that never connected shows no start, when attempts ended, and how long it tried", () => {
    const d = videoDetails(rtsp({ status: "failed", started_at: null, ended_at: "2026-11-10T12:05:00Z", created_at: "2026-11-10T12:00:00Z", duration_s: null, file_size: null,
      status_reason: "The camera did not come online within 5 min (15 attempts)." }), now);
    expect(get(d, "Recording started")).toMatchObject({ value: "never started (the camera did not connect)", tone: "muted" });
    expect(get(d, "Attempts ended")?.value).toBe(fmtDateTime("2026-11-10T12:05:00Z"));
    expect(get(d, "Attempted for")?.value).toBe("05:00");
    expect(get(d, "Recording ended")).toBeUndefined();
    expect(get(d, "Why it failed")).toMatchObject({ tone: "bad" });
    expect(get(d, "Recorded")).toBeUndefined();
  });
  it("a recording that began after a late connection shows its real start and the loss time as the end", () => {
    const d = videoDetails(rtsp({ status: "partial", created_at: "2026-11-10T12:00:00Z", started_at: "2026-11-10T12:00:40Z", ended_at: "2026-11-10T12:03:10Z", duration_s: 150,
      status_reason: "The camera stopped sending video at 12:03:10 (the connection was lost)." }), now);
    expect(get(d, "Requested")?.value).toBe(fmtDateTime("2026-11-10T12:00:00Z"));
    expect(get(d, "Recording started")?.value).toBe(fmtDateTime("2026-11-10T12:00:40Z"));
    expect(get(d, "Recording ended")?.value).toBe(fmtDateTime("2026-11-10T12:03:10Z"));
    expect(get(d, "Recorded")).toMatchObject({ value: "02:30 of 05:00 planned (ended early)", tone: "warn" });
  });
});

describe("videoDetails: RTSP recordings", () => {
  it("a finished full recording shows start, end and recorded of planned", () => {
    const d = videoDetails(rtsp(), 0);
    expect(get(d, "Stream")).toMatchObject({ value: "rtsp://***:***@10.0.0.5:554/ch1", wide: true });
    expect(get(d, "Requested")).toBeTruthy();
    expect(get(d, "Recording started")?.value).toBe(fmtDateTime("2026-11-10T12:00:00Z"));
    expect(get(d, "Recording ended")?.value).toBe(fmtDateTime("2026-11-10T12:05:00Z"));
    expect(get(d, "Recorded")).toMatchObject({ value: "05:00 of 05:00 planned" });
    expect(get(d, "Recorded")?.tone).toBeUndefined();
  });
  it("shows which saved camera it came from", () => {
    expect(get(videoDetails(rtsp({ camera_id: 3, camera_name: "Entrance" }), 0), "Camera")?.value).toBe("Entrance");
    expect(get(videoDetails(rtsp(), 0), "Camera")).toBeUndefined(); // a one-off link has no camera
  });
  it("a recording that ended early is flagged", () => {
    const d = videoDetails(rtsp({ duration_s: 61, status_reason: "Stopped manually after 61 s" }), 0);
    expect(get(d, "Recorded")).toMatchObject({ value: "01:01 of 05:00 planned (ended early)", tone: "warn" });
    expect(get(d, "Note")?.value).toBe("Stopped manually after 61 s");
  });
  it("a few seconds short is not 'early' (grace)", () => expect(get(videoDetails(rtsp({ duration_s: 297 }), 0), "Recorded")?.tone).toBeUndefined());
  it("a live recording shows planned end and progress", () => {
    const start = new Date("2026-11-10T12:00:00Z").getTime();
    const d = videoDetails(rtsp({ status: "recording", ended_at: null, duration_s: null, file_size: null }), start + 90_000);
    expect(get(d, "Recorded so far")?.value).toBe("01:30 of 05:00");
    expect(get(d, "Planned end")?.value).toBe(fmtDateTime("2026-11-10T12:05:00.000Z"));
    expect(get(d, "Recording ended")).toBeUndefined();
  });
  it("a recording that never started says the recorder is not picking it up", () => {
    const d = videoDetails(rtsp({ status: "recording", started_at: null, ended_at: null, created_at: "2026-11-10T12:00:00Z" }), new Date("2026-11-10T12:05:00Z").getTime());
    expect(get(d, "Recording started")).toMatchObject({ value: "waiting for the recorder…", tone: "warn" });
  });
  it("progress never exceeds the plan and a not-yet-started job says so", () => {
    const start = new Date("2026-11-10T12:00:00Z").getTime();
    expect(get(videoDetails(rtsp({ status: "recording", ended_at: null }), start + 9_999_000), "Recorded so far")?.value).toBe("05:00 of 05:00");
    const queued = videoDetails(rtsp({ status: "recording", started_at: null, ended_at: null }), start);
    expect(get(queued, "Recording started")?.value).toBe("starting…");
    expect(get(queued, "Planned end")?.value).toBe("—");
  });
  it("partial and failed show the reason with a tone", () => {
    const p = videoDetails(rtsp({ status: "partial", duration_s: 20, status_reason: "Stream dropped after 20 s" }), 0);
    expect(get(p, "Why it is partial")).toMatchObject({ value: "Stream dropped after 20 s", tone: "warn", wide: true });
    const f = videoDetails(rtsp({ status: "failed", duration_s: null, file_size: null, status_reason: "Could not record the stream." }), 0);
    expect(get(f, "Why it failed")).toMatchObject({ tone: "bad" });
    expect(get(f, "Recorded")).toBeUndefined();
    expect(get(f, "Attempt ran for")?.value).toBe("05:00");
  });
  it("old rows without start/end times degrade gracefully", () => {
    const d = videoDetails(rtsp({ started_at: null, ended_at: null, duration_s: 300 }), 0);
    expect(get(d, "Recording started")?.value).toBe("not recorded");
    expect(get(d, "Recording ended")?.value).toBe("not recorded");
    expect(get(d, "Recorded")?.value).toBe("05:00 of 05:00 planned");
  });
});
