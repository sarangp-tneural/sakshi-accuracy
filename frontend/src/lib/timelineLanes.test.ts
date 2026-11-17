import { describe, expect, it } from "vitest";
import { hitMarker, laneOffset, layoutY } from "./timelineView";

const rows = { in: 40, out: 76, other: 58 };
const m = (time_s: number, direction: "in" | "out" | null = "in") => ({ time_s, direction });
const v = { start: 0, end: 100 }; // 1 s = 10 px at width 1000

describe("layoutY", () => {
  it("stacks marks at the same time on separate lanes", () => {
    const ys = layoutY([m(5), m(5), m(5)], v, 1000, rows, 30, 86);
    expect(ys).toEqual([40, 53, 30]); // lane 0, +13, then -13 clamped to the top limit
    expect(new Set(ys).size).toBe(3);
  });
  it("leaves well-separated marks on the row line", () => {
    expect(layoutY([m(5), m(10), m(20)], v, 1000, rows, 30, 86)).toEqual([40, 40, 40]);
  });
  it("separates again once zoomed in", () => {
    const zoomed = { start: 4, end: 6 }; // 1 s = 500 px
    expect(layoutY([m(5), m(5.1)], zoomed, 1000, rows, 30, 86)).toEqual([40, 40]);
  });
  it("keeps IN, OUT and other rows independent", () => {
    expect(layoutY([m(5, "in"), m(5, "out"), m(5, null)], v, 1000, rows, 30, 86)).toEqual([40, 76, 58]);
  });
  it("laneOffset alternates around the row", () => {
    expect([0, 1, 2, 3, 4].map((l) => laneOffset(l))).toEqual([0, 13, -13, 26, -26]);
  });
});

describe("hitMarker with stacked marks", () => {
  it("hits the stacked marker, not the one underneath", () => {
    const items = [m(5), m(5)];
    const ys = layoutY(items, v, 1000, rows, 30, 86);
    expect(hitMarker(items, v, 1000, 50, 40, rows, 6, ys)).toBe(0);
    expect(hitMarker(items, v, 1000, 50, 53, rows, 6, ys)).toBe(1);
  });
});
