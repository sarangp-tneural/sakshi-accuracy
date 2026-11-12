import { describe, expect, it } from "vitest";
import { clientToNorm, distToSegment, dragLine, hitTest, lineLength, newLine, nextName, overlayRect, type VirtualLine } from "./lines";

const L = (o: Partial<VirtualLine> = {}): VirtualLine => ({ id: "a", name: "A", x1: 0.2, y1: 0.5, x2: 0.8, y2: 0.5, color: "#ffcc00", ...o });
const size = { w: 1000, h: 500 };

describe("lines geometry", () => {
  it("measures distance to a segment, clamped at the ends", () => {
    expect(distToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distToSegment(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(distToSegment(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });

  it("hits an endpoint before the body", () => {
    expect(hitTest([L()], 0.2, 0.5, size)).toEqual({ id: "a", part: "p1" });
    expect(hitTest([L()], 0.8, 0.5, size)).toEqual({ id: "a", part: "p2" });
    expect(hitTest([L()], 0.5, 0.5, size)).toEqual({ id: "a", part: "body" });
  });

  it("misses when far from every line, and prefers the line drawn on top", () => {
    expect(hitTest([L()], 0.5, 0.9, size)).toBeNull();
    expect(hitTest([L({ id: "a" }), L({ id: "b" })], 0.5, 0.5, size)?.id).toBe("b");
  });

  it("uses pixels, not fractions, for tolerance", () => {
    // 0.01 of the height is 5px on this picture: still a body hit; 0.03 is 15px: a miss
    expect(hitTest([L()], 0.5, 0.51, size)?.part).toBe("body");
    expect(hitTest([L()], 0.5, 0.53, size)).toBeNull();
  });

  it("drags an endpoint and clamps to the picture", () => {
    expect(dragLine(L(), "p2", 1.5, -2)).toMatchObject({ x2: 1, y2: 0, x1: 0.2, y1: 0.5 });
  });

  it("moves the whole line but never off the picture", () => {
    const m = dragLine(L(), "body", 0, 0, 0.5, 0.1);
    expect(m.x2).toBeCloseTo(1); expect(m.x1).toBeCloseTo(0.4); expect(m.y1).toBeCloseTo(0.6);
    expect(lineLength(m)).toBeCloseTo(lineLength(L()));
  });

  it("names new lines without clashing", () => {
    expect(nextName([])).toBe("Line 1");
    expect(nextName([L({ name: "Line 2" })])).toBe("Line 3");
    expect(newLine([], 2, -1)).toMatchObject({ x1: 1, y1: 0, x2: 1, y2: 0 });
  });

  it("converts pointer position to the picture box", () => {
    expect(clientToNorm(150, 60, { left: 100, top: 10, width: 200, height: 100 })).toEqual({ x: 0.25, y: 0.5 });
    expect(clientToNorm(0, 999, { left: 100, top: 10, width: 200, height: 100 })).toEqual({ x: 0, y: 1 });
  });

  it("places the overlay with zoom and pan applied", () => {
    expect(overlayRect({ x: 10, y: 20, w: 100, h: 50 }, { tx: 5, ty: -5, scale: 2 })).toEqual({ x: 25, y: 35, w: 200, h: 100 });
  });
});
