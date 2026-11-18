import { describe, expect, it } from "vitest";
import { nextKept, prevKept, savedLabel, stillSpans } from "./stills";

const kept = [0, 5, 6, 8.2, 13];

describe("stills", () => {
  it("finds the next kept moment", () => {
    expect(nextKept(kept, 0)).toBe(5);
    expect(nextKept(kept, 5.97)).toBe(8.2); // 5.97 is "at" 6
    expect(nextKept(kept, 13)).toBeNull();
    expect(nextKept([], 0)).toBeNull();
  });
  it("finds the previous kept moment", () => {
    expect(prevKept(kept, 8.2)).toBe(6);
    expect(prevKept(kept, 7)).toBe(6);
    expect(prevKept(kept, 0)).toBeNull();
  });
  it("shades only real gaps", () => {
    expect(stillSpans([0, 0.2, 5], 6, 5)).toEqual([[0.4, 5], [5.2, 6]]);
  });
  it("shows the time saved", () => {
    expect(savedLabel({ duration_s: 1800, reviewed_s: 360 })).toBe("30:00 → 6:00");
  });
});
