import { describe, expect, it } from "vitest";
import { deleteWarning, isOpenable } from "./videoRow";

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
