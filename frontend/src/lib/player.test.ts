import { describe, expect, it } from "vitest";
import { IDENTITY, MAX_SCALE, clampTransform, panBy, zoomAt } from "./viewport";
import { containRect, normToStage, stageToNorm } from "./contentRect";
import { MIN_SPAN, ensureVisible, fullView, hitMarker, panView, rulerStep, timeToX, visibleSlice, xToTime, zoomView } from "./timelineView";
import { medianGap, plausibleFrameGap, stepTarget } from "./frameStep";
import { parseTime } from "./parseTime";

describe("viewport", () => {
  it("zoomAt keeps the point under the cursor fixed", () => {
    const t = zoomAt(IDENTITY, 2, 300, 200, 800, 600);
    // stage point under the cursor before: 300; after: (300 - tx) / scale
    expect((300 - t.tx) / t.scale).toBeCloseTo(300);
    expect((200 - t.ty) / t.scale).toBeCloseTo(200);
  });
  it("clamps scale and keeps the picture covering the viewport", () => {
    expect(zoomAt(IDENTITY, 100, 0, 0, 800, 600).scale).toBe(MAX_SCALE);
    expect(zoomAt(IDENTITY, 0.01, 0, 0, 800, 600).scale).toBe(1);
    const c = clampTransform({ scale: 2, tx: 50, ty: -9999 }, 800, 600);
    expect(c.tx).toBe(0);
    expect(c.ty).toBe(600 - 1200);
  });
  it("panBy cannot pan at scale 1", () => expect(panBy(IDENTITY, 100, 100, 800, 600)).toEqual(IDENTITY));
});

describe("contentRect", () => {
  it("pillarboxes a tall video in a wide box", () => {
    const r = containRect(1000, 500, 500, 500);
    expect(r).toEqual({ x: 250, y: 0, w: 500, h: 500 });
  });
  it("letterboxes a wide video in a tall box", () => {
    const r = containRect(800, 800, 1600, 900);
    expect(r.w).toBe(800);
    expect(r.h).toBeCloseTo(450);
    expect(r.y).toBeCloseTo(175);
  });
  it("falls back to the box while the video size is unknown", () => expect(containRect(300, 200, 0, 0)).toEqual({ x: 0, y: 0, w: 300, h: 200 }));
  it("maps pointer to picture coordinates, ignoring the black bars", () => {
    const pic = containRect(1000, 500, 500, 500); // x 250..750
    expect(stageToNorm(250, 0, pic, IDENTITY)).toEqual({ x: 0, y: 0, inside: true });
    expect(stageToNorm(750, 500, pic, IDENTITY)).toEqual({ x: 1, y: 1, inside: true });
    expect(stageToNorm(500, 250, pic, IDENTITY)).toEqual({ x: 0.5, y: 0.5, inside: true });
    const bar = stageToNorm(100, 250, pic, IDENTITY);
    expect(bar.inside).toBe(false);
    expect(bar.x).toBe(0); // clamped
  });
  it("round-trips with zoom and pan", () => {
    const pic = containRect(1280, 720, 1920, 1080);
    const tr = zoomAt(zoomAt(IDENTITY, 3, 900, 300, 1280, 720), 1.5, 400, 500, 1280, 720);
    for (const [nx, ny] of [[0.1, 0.9], [0.5, 0.5], [0.77, 0.2]]) {
      const s = normToStage(nx, ny, pic, tr);
      const back = stageToNorm(s.x, s.y, pic, tr);
      expect(back.x).toBeCloseTo(nx, 9);
      expect(back.y).toBeCloseTo(ny, 9);
    }
  });
});

describe("timelineView", () => {
  const dur = 600;
  it("timeToX and xToTime are inverses", () => {
    const v = { start: 100, end: 160 };
    expect(xToTime(timeToX(123.4, v, 900), v, 900)).toBeCloseTo(123.4);
    expect(timeToX(100, v, 900)).toBe(0);
    expect(timeToX(160, v, 900)).toBe(900);
  });
  it("zoom keeps the anchor time at the same screen ratio and respects limits", () => {
    const v = fullView(dur);
    const z = zoomView(v, dur, 4, 300);
    expect(z.end - z.start).toBeCloseTo(150);
    expect((300 - z.start) / (z.end - z.start)).toBeCloseTo(0.5);
    const tiny = zoomView(z, dur, 1000, 300);
    expect(tiny.end - tiny.start).toBe(MIN_SPAN);
    const out = zoomView(z, dur, 0.0001, 300);
    expect(out).toEqual(fullView(dur));
  });
  it("pan and ensureVisible stay inside [0, duration]", () => {
    const v = { start: 0, end: 60 };
    expect(panView(v, dur, -50)).toEqual(v);
    expect(panView(v, dur, 1e6)).toEqual({ start: 540, end: 600 });
    expect(ensureVisible(v, dur, 30)).toBe(v);
    const moved = ensureVisible(v, dur, 300);
    expect(moved.end - moved.start).toBe(60);
    expect(300).toBeGreaterThanOrEqual(moved.start);
    expect(300).toBeLessThanOrEqual(moved.end);
  });
  it("short videos still get a minimum span", () => expect(fullView(0.5)).toEqual({ start: 0, end: MIN_SPAN }));
  it("rulerStep keeps labels apart", () => {
    expect(rulerStep(60, 600)).toBe(10);
    expect(rulerStep(3, 600)).toBe(0.5);
    expect(rulerStep(1e6, 600)).toBe(3600);
  });
  it("visibleSlice windows an ascending list", () => {
    const t = [1, 2, 3, 10, 11, 20];
    expect(visibleSlice(t, { start: 2, end: 11 })).toEqual([1, 5]);
    expect(visibleSlice(t, { start: 100, end: 200 })).toEqual([6, 6]);
    expect(visibleSlice(t, { start: 0, end: 100 })).toEqual([0, 6]);
    expect(visibleSlice(t, { start: 12, end: 15 }, 6)).toEqual([3, 6]);
  });
  it("hitMarker picks the nearest marker on the right row within the radius", () => {
    const items = [{ time_s: 10, direction: "in" as const }, { time_s: 10, direction: "out" as const }, { time_s: 50, direction: "in" as const }];
    const v = { start: 0, end: 100 };
    const row = { in: 10, out: 30 };
    expect(hitMarker(items, v, 1000, 100, 10, row)).toBe(0);
    expect(hitMarker(items, v, 1000, 100, 30, row)).toBe(1);
    expect(hitMarker(items, v, 1000, 500, 10, row)).toBe(2);
    expect(hitMarker(items, v, 1000, 300, 10, row)).toBe(-1);
    expect(hitMarker([], v, 1000, 1, 1, row)).toBe(-1);
  });
});

describe("frameStep", () => {
  it("median needs 3 samples and ignores outliers", () => {
    expect(medianGap([0.04, 0.04])).toBeNull();
    expect(medianGap([0.04, 0.5, 0.04, 0.04, 0.041])).toBeCloseTo(0.04);
  });
  it("each step moves exactly one frame on a 25 fps grid, from anywhere inside a frame", () => {
    const step = 0.04;
    const frame = (t: number) => Math.floor(t / step + 1e-6);
    for (const t of [0, 0.001, 0.0399, 1.0, 1.0201, 7.3333]) {
      const f = frame(t);
      expect(frame(stepTarget(t, step, 1))).toBe(f + 1);
      expect(frame(stepTarget(t, step, -1))).toBe(Math.max(0, f - 1));
    }
    let t = 1.0;
    const start = frame(t);
    for (let i = 0; i < 10; i++) t = stepTarget(t, step, 1);
    expect(frame(t)).toBe(start + 10);
    for (let i = 0; i < 10; i++) t = stepTarget(t, step, -1);
    expect(frame(t)).toBe(start);
  });
  it("only plausible single-frame gaps are used to learn the frame time", () => {
    const nominal = 0.04;
    expect(plausibleFrameGap(0.04, nominal)).toBe(true);
    expect(plausibleFrameGap(0.0415, nominal)).toBe(true); // a little jitter / VFR
    expect(plausibleFrameGap(0.08, nominal)).toBe(true); // one dropped frame still within 2.5x
    expect(plausibleFrameGap(0.26, nominal)).toBe(false); // a seek jump of several frames
    expect(plausibleFrameGap(0.005, nominal)).toBe(false);
    expect(plausibleFrameGap(0, nominal)).toBe(false);
    expect(plausibleFrameGap(0.7, null)).toBe(false); // always rejected past half a second
    expect(plausibleFrameGap(0.1, null)).toBe(true); // no fps known: loose range only
  });
  it("steps N frames at once (one frame per unit of playback speed)", () => {
    const step = 0.04;
    const frame = (t: number) => Math.floor(t / step + 1e-6);
    for (const n of [1, 2, 3, 4]) {
      const f = frame(2.013);
      expect(frame(stepTarget(2.013, step, 1, n))).toBe(f + n);
      expect(frame(stepTarget(2.013, step, -1, n))).toBe(f - n);
    }
    expect(stepTarget(0.05, 0.04, -1, 4)).toBeGreaterThanOrEqual(0); // clamps at the start
    expect(frame(stepTarget(1, step, 1, 0))).toBe(frame(1) + 1); // never less than one frame
    expect(frame(stepTarget(1, step, 1, 2.6))).toBe(frame(1) + 3); // rounds
  });
  it("never goes below zero", () => expect(stepTarget(0, 0.04, -1)).toBeGreaterThanOrEqual(0));
});

describe("parseTime", () => {
  it("parses seconds and clock forms", () => {
    expect(parseTime("83")).toBe(83);
    expect(parseTime("83.5")).toBe(83.5);
    expect(parseTime("1:23")).toBe(83);
    expect(parseTime(" 1:23.5 ")).toBe(83.5);
    expect(parseTime("1:02:03")).toBe(3723);
  });
  it("rejects junk", () => {
    for (const bad of ["", "abc", "1:", ":5", "1:2:3:4", "-5", "1.5:30", "1:30s"]) expect(parseTime(bad), bad).toBeNull();
  });
});
