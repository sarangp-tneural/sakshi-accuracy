import { describe, expect, it } from "vitest";
import { lengthOptions, recordingText, startLabel, validateCamera } from "./cameras";
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
