import { describe, expect, it } from "vitest";
import { hitRoi, moveRect, rectFromDrag, resizeRect } from "./roi";

const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };

describe("roi", () => {
  it("draws in any direction and never leaves the picture", () => {
    const a = rectFromDrag(0.6, 0.6, 0.2, 0.2);
    expect([a.x, a.y, a.w, a.h]).toEqual([0.2, 0.2, expect.closeTo(0.4), expect.closeTo(0.4)]);
    const tiny = rectFromDrag(0.5, 0.5, 0.5, 0.5);
    expect(tiny.w).toBeGreaterThan(0.02);
    const edge = rectFromDrag(0.99, 0.99, 0.995, 0.995);
    expect(edge.x + edge.w).toBeLessThanOrEqual(1);
    expect(edge.y + edge.h).toBeLessThanOrEqual(1);
  });
  it("moves but stays inside", () => {
    const m = moveRect(r, 0.1, -0.5);
    expect(m.x).toBeCloseTo(0.3); expect(m.y).toBe(0);
    expect(moveRect(r, 5, 0).x).toBeCloseTo(0.6);
  });
  it("resizes from a corner, keeping the opposite one", () => {
    const n = resizeRect(r, "se", 0.8, 0.9);
    expect(n.x).toBe(0.2); expect(n.y).toBe(0.2);
    expect(n.w).toBeCloseTo(0.6); expect(n.h).toBeCloseTo(0.7);
    const nw = resizeRect(r, "nw", 0.1, 0.1);
    expect(nw.x).toBeCloseTo(0.1); expect(nw.x + nw.w).toBeCloseTo(0.6);
  });
  it("hits corners before the body", () => {
    expect(hitRoi(r, 0.21, 0.21, 0.02, 0.02)).toBe("nw");
    expect(hitRoi(r, 0.4, 0.4, 0.02, 0.02)).toBe("body");
    expect(hitRoi(r, 0.9, 0.9, 0.02, 0.02)).toBeNull();
  });
});
