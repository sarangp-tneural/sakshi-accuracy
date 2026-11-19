import { describe, expect, it } from "vitest";
import { attemptingFor, deleteWarning, isActive, isOpenable, parseAttempt, stopDialog, stopLabel, stopMessage } from "./videoRow";

describe("deleteWarning", () => {
  it("names the marks and the Sakshi result that will be removed", () => {
    expect(deleteWarning({ name: "cam1.mp4", mark_total: 14, sakshi_entered: true })).toBe("“cam1.mp4” and its 14 marks and its Sakshi result will be permanently deleted. This cannot be undone.");
    expect(deleteWarning({ name: "a", mark_total: 1, sakshi_entered: false })).toBe("“a” and its 1 mark will be permanently deleted. This cannot be undone.");
    expect(deleteWarning({ name: "b", mark_total: 0, sakshi_entered: true })).toBe("“b” and its Sakshi result will be permanently deleted. This cannot be undone.");
  });
  it("says so when there is nothing else to lose", () => {
    expect(deleteWarning({ name: "c", mark_total: 0, sakshi_entered: false })).toBe("“c” will be permanently deleted. The video file is removed from the server.");
  });
});

describe("isOpenable", () => {
  it("only ready and partial videos open", () => {
    expect(isOpenable({ status: "ready" })).toBe(true);
    expect(isOpenable({ status: "partial" })).toBe(true);
    for (const s of ["recording", "processing", "failed"] as const) expect(isOpenable({ status: s })).toBe(false);
  });
});

describe("stopMessage", () => {
  it("says what really happened", () => {
    expect(stopMessage({ status: "recording", status_reason: null })).toBe("Stopping… saving the video");
    expect(stopMessage({ status: "processing", status_reason: "kept" })).toMatch(/Saving the part/);
    expect(stopMessage({ status: "failed", status_reason: "The recorder stopped before this recording began." })).toBe("The recorder stopped before this recording began.");
    expect(stopMessage({ status: "failed", status_reason: null })).toMatch(/Nothing was recorded/);
    expect(stopMessage({ status: "ready", status_reason: null })).toBe("Stopped");
  });
});

describe("attempting helpers", () => {
  it("isActive covers attempting and recording, nothing else", () => {
    expect(isActive({ status: "connecting" }) && isActive({ status: "recording" })).toBe(true);
    for (const s of ["processing", "ready", "partial", "failed"] as const) expect(isActive({ status: s })).toBe(false);
  });
  it("parseAttempt reads the try number and the reason", () => {
    expect(parseAttempt("Attempt 3 · The camera refused the connection.")).toEqual({ n: 3, note: "The camera refused the connection." });
    expect(parseAttempt("Attempt 1 · connecting…")).toEqual({ n: 1, note: "connecting…" });
    expect(parseAttempt("Attempt 12")).toEqual({ n: 12, note: "" });
    expect(parseAttempt("Attempt 2 · line one\nline two")).toEqual({ n: 2, note: "line one\nline two" });
  });
  it("parseAttempt leaves anything else alone", () => {
    expect(parseAttempt(null)).toEqual({ n: null, note: "" });
    expect(parseAttempt("")).toEqual({ n: null, note: "" });
    expect(parseAttempt("Could not record the stream.")).toEqual({ n: null, note: "Could not record the stream." });
  });
  it("attemptingFor counts from the request and never goes negative", () => {
    const created = "2026-11-10T12:00:00Z", now = new Date("2026-11-10T12:00:42Z").getTime();
    expect(attemptingFor(created, now)).toBe(42);
    expect(attemptingFor(created, now - 100_000)).toBe(0);
    expect(attemptingFor("nope", now)).toBe(0);
  });
  it("the button says Cancel while attempting and Stop while recording", () => {
    expect(stopLabel({ status: "connecting" })).toBe("Cancel");
    expect(stopLabel({ status: "recording" })).toBe("■ Stop");
  });
  it("the confirmation says what will happen", () => {
    expect(stopDialog(true)).toMatchObject({ title: "Cancel the attempt?", confirm: "Cancel the attempt" });
    expect(stopDialog(true).message).toMatch(/Nothing will be recorded/);
    expect(stopDialog(false)).toMatchObject({ title: "Stop recording?", confirm: "Stop and keep video" });
  });
  it("the message after cancelling an attempt", () => expect(stopMessage({ status: "connecting", status_reason: null })).toBe("Cancelling the attempt…"));
});

import { canRemoveFile, isFileRemoved, removeFileWarning } from "./videoRow";
import { fmtBytes } from "./format";

describe("deleting only the video file", () => {
  it("is offered for finished videos whose file still exists", () => {
    for (const status of ["ready", "partial", "failed"] as const) expect(canRemoveFile({ status, video_removed_at: null })).toBe(true);
    for (const status of ["connecting", "recording", "processing"] as const) expect(canRemoveFile({ status, video_removed_at: null })).toBe(false);
    expect(canRemoveFile({ status: "ready", video_removed_at: "2026-11-11T10:00:00Z" })).toBe(false);
    expect(canRemoveFile({ status: "ready" })).toBe(true); // older API answers
    expect(isFileRemoved({ video_removed_at: "x" })).toBe(true);
    expect(isFileRemoved({})).toBe(false);
  });
  it("the confirmation says what is freed, what stays and that it cannot be undone", () => {
    const m = removeFileWarning({ name: "cam", mark_total: 24, sakshi_entered: true, disk_bytes: 62 * 1024 ** 2, file_size: 1 }, fmtBytes);
    expect(m).toContain("“cam”");
    expect(m).toContain(`frees about ${fmtBytes(62 * 1024 ** 2)}`);
    expect(m).toContain("24 marks, the Sakshi result and all its details stay");
    expect(m).toContain("cannot be undone");
  });
  it("copes with no marks, no Sakshi result and an unknown size", () => {
    const m = removeFileWarning({ name: "a", mark_total: 1, sakshi_entered: false, disk_bytes: null, file_size: null }, fmtBytes);
    expect(m).not.toContain("frees");
    expect(m).toContain("1 mark and all its details stay");
    expect(removeFileWarning({ name: "b", mark_total: 0, sakshi_entered: false, disk_bytes: null, file_size: 2048 }, fmtBytes)).toMatch(/frees about 2\.0 KB\. All its details stay\./);
  });
});

import { processingPhase, secondsBetween } from "./videoRow";

describe("processingPhase", () => {
  const p = (o: Record<string, string | null>) => processingPhase({ status: "processing", queued_at: null, converting_at: null, converted_at: null, ...o } as never);
  it("is waiting until the conversion starts, then compressing", () => {
    expect(p({ queued_at: "2026-11-19T10:00:00Z" })).toBe("waiting");
    expect(p({ queued_at: "2026-11-19T10:00:00Z", converting_at: "2026-11-19T10:05:00Z" })).toBe("compressing");
  });
  it("is plain processing for older videos without times, and null for other statuses", () => {
    expect(p({})).toBe("processing");
    expect(processingPhase({ status: "ready", queued_at: null, converting_at: null, converted_at: null })).toBeNull();
  });
});

describe("secondsBetween", () => {
  it("measures between two times, or up to now", () => {
    expect(secondsBetween("2026-11-19T10:00:00Z", "2026-11-19T10:01:30Z", 0)).toBe(90);
    expect(secondsBetween("2026-11-19T10:00:00Z", null, Date.parse("2026-11-19T10:00:10Z"))).toBe(10);
    expect(secondsBetween(null, null, 0)).toBeNull();
  });
});

import { canConvert } from "./videoRow";

describe("canConvert", () => {
  const c = (o: Record<string, unknown>) => canConvert({ status: "ready", playback_vcodec: "hevc", video_removed_at: null, ...o } as never);
  it("is offered for a saved video whose copy is not H.264", () => {
    expect(c({})).toBe(true);
    expect(c({ status: "partial" })).toBe(true);
  });
  it("is not offered when it is H.264 already, unknown (older video), busy, or the file is gone", () => {
    expect(c({ playback_vcodec: "h264" })).toBe(false);
    expect(c({ playback_vcodec: null })).toBe(false);
    expect(c({ status: "processing" })).toBe(false);
    expect(c({ status: "failed" })).toBe(false);
    expect(c({ video_removed_at: "2026-11-19T10:00:00Z" })).toBe(false);
  });
});
