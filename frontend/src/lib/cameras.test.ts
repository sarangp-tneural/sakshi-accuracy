import { describe, expect, it } from "vitest";
import { RECORDER_WAIT_S, attemptingText, lengthOptions, recordingText, startLabel, validateCamera, waitingForRecorder } from "./cameras";
import { validateRtsp } from "./rtsp";

const ok = { name: "Entrance", url: "rtsp://u:p@10.0.0.5:554/s", minutes: 30 };

describe("validateCamera", () => {
  it("accepts a good camera", () => expect(validateCamera(ok, false)).toEqual({}));
  it("needs a name, not just spaces, at most 100 characters", () => {
    expect(validateCamera({ ...ok, name: "" }, false).name).toBeTruthy();
    expect(validateCamera({ ...ok, name: "   " }, false).name).toBeTruthy();
    expect(validateCamera({ ...ok, name: "x".repeat(100) }, false).name).toBeUndefined();
    expect(validateCamera({ ...ok, name: "x".repeat(101) }, false).name).toMatch(/100/);
  });
  it("needs an rtsp:// or rtsps:// link without spaces", () => {
    expect(validateCamera({ ...ok, url: "" }, false).url).toBeTruthy();
    expect(validateCamera({ ...ok, url: "http://x" }, false).url).toMatch(/rtsp/);
    expect(validateCamera({ ...ok, url: "rtsps://h/x" }, false).url).toBeUndefined();
    expect(validateCamera({ ...ok, url: "rtsp://h/a b" }, false).url).toBeTruthy();
  });
  it("needs a whole number of minutes from 1 to 120", () => {
    for (const m of [0, 121, -5, 2.5, NaN]) expect(validateCamera({ ...ok, minutes: m }, false).minutes, String(m)).toBeTruthy();
    for (const m of [1, 30, 120]) expect(validateCamera({ ...ok, minutes: m }, false).minutes).toBeUndefined();
  });
  it("when editing, an empty link means keep the saved one, but a typed link is still checked", () => {
    expect(validateCamera({ ...ok, url: "" }, true)).toEqual({});
    expect(validateCamera({ ...ok, url: "http://bad" }, true).url).toBeTruthy();
  });
});

describe("lengthOptions", () => {
  it("lists the presets, plus the default once when it is not a preset", () => {
    expect(lengthOptions(30)).toEqual([5, 10, 15, 30, 45, 60, 90, 120]);
    expect(lengthOptions(20)).toEqual([5, 10, 15, 20, 30, 45, 60, 90, 120]);
    expect(lengthOptions(1)[0]).toBe(1);
  });
  it("ignores a default that is out of range", () => {
    expect(lengthOptions(0)).toEqual([5, 10, 15, 30, 45, 60, 90, 120]);
    expect(lengthOptions(500)).not.toContain(500);
  });
});

describe("labels", () => {
  it("startLabel", () => expect(startLabel(30)).toBe("Start recording · 30 min"));
  it("recordingText shows elapsed of total, or starting before ffmpeg runs", () => {
    const start = "2026-11-10T12:00:00Z";
    const at = (s: number) => new Date(start).getTime() + s * 1000;
    expect(recordingText(start, 30, at(723))).toBe("12:03 / 30:00");
    expect(recordingText(start, 5, at(99999))).toBe("05:00 / 05:00"); // never past the plan
    expect(recordingText(null, 30, at(5))).toBe("starting…");
    expect(recordingText(start, null, at(5))).toBe("starting…");
  });
});

describe("validateRtsp (shared with the one-off dialog)", () => {
  it("still validates link and minutes", () => {
    expect(validateRtsp("rtsp://h/x", 5)).toEqual({});
    expect(validateRtsp("", 5).url).toBeTruthy();
    expect(validateRtsp("rtsp://h/x", 500).minutes).toMatch(/120/);
  });
});

describe("waiting for the recorder", () => {
  const created = "2026-11-10T12:00:00Z";
  const at = (s: number) => new Date(created).getTime() + s * 1000;
  it("a fresh request is just starting; after 20 s it says the recorder has not picked it up", () => {
    expect(waitingForRecorder(null, created, at(5))).toBe(false);
    expect(waitingForRecorder(null, created, at(RECORDER_WAIT_S))).toBe(false);
    expect(waitingForRecorder(null, created, at(RECORDER_WAIT_S + 1))).toBe(true);
  });
  it("once ffmpeg has started it is never 'waiting'", () => expect(waitingForRecorder("2026-11-10T12:00:03Z", created, at(500))).toBe(false));
  it("no request time known: do not claim anything", () => {
    expect(waitingForRecorder(null, null, at(500))).toBe(false);
    expect(waitingForRecorder(null, "nope", at(500))).toBe(false);
  });
  it("recordingText uses it", () => {
    expect(recordingText(null, 30, at(5), created)).toBe("starting…");
    expect(recordingText(null, 30, at(60), created)).toBe("waiting for the recorder…");
    expect(recordingText(null, 30, at(60))).toBe("starting…"); // old callers without a request time
    expect(recordingText("2026-11-10T12:00:03Z", 30, at(63), created)).toBe("01:00 / 30:00");
  });
});

describe("attemptingText (the camera card while attempting)", () => {
  const created = "2026-11-10T12:00:00Z";
  const at = (s: number) => new Date(created).getTime() + s * 1000;
  it("shows the try number and time, with the last reason as detail", () => {
    expect(attemptingText("Attempt 3 · The camera refused the connection.", created, at(42))).toEqual({ line: "try 3 · 00:42", detail: "The camera refused the connection.", warn: false });
    expect(attemptingText("Attempt 1 · connecting…", created, at(1))).toMatchObject({ line: "try 1 · 00:01", detail: "connecting…" });
  });
  it("before any try has been reported it is starting, and after 20 s it says the recorder is not picking it up", () => {
    expect(attemptingText(null, created, at(5))).toMatchObject({ line: "starting… 00:05", warn: false });
    expect(attemptingText(null, created, at(RECORDER_WAIT_S + 1))).toMatchObject({ line: expect.stringContaining("waiting for the recorder…"), warn: true });
    expect(attemptingText(null, created, at(RECORDER_WAIT_S + 1)).detail).toMatch(/run.sh/);
  });
  it("once a try is reported it is never 'waiting for the recorder'", () => expect(attemptingText("Attempt 1 · connecting…", created, at(500)).warn).toBe(false));
  it("a missing request time does not break it", () => expect(attemptingText(null, null, at(500))).toMatchObject({ line: "starting… 00:00" }));
});
