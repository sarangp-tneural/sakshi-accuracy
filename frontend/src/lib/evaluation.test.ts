import { describe, expect, it } from "vitest";
import type { EvalScalars } from "../api";
import { SAME_TYPES, fmtOver, fmtPct, parseEvalForm, parseTypeTpForm, toEvalForm, toTypeTpForm, tpShortcut } from "./evaluation";

const EMPTY: EvalScalars = { tp: null, gender_assigned: null, real_male_in_tp: null, real_female_in_tp: null, correct_male: null, correct_female: null };

describe("evaluation form", () => {
  it("round-trips and treats blank as not entered, not 0", () => {
    const f = toEvalForm({ ...EMPTY, tp: 27, correct_male: 0 });
    expect(f.tp).toBe("27"); expect(f.correct_male).toBe("0"); expect(f.gender_assigned).toBe("");
    expect(parseEvalForm(f).values).toEqual({ ...EMPTY, tp: 27, correct_male: 0 });
  });
  it("rejects anything but a whole number", () => {
    const { errors } = parseEvalForm({ ...toEvalForm(EMPTY), tp: "2.5", correct_male: "-1", gender_assigned: "abc" });
    expect(Object.keys(errors).sort()).toEqual(["correct_male", "gender_assigned", "tp"]);
  });
  it("shortcuts: all real = system, nothing missed = actual", () => {
    expect(tpShortcut("all_real", { actual: 111, system: 103 })).toBe(103);
    expect(tpShortcut("nothing_missed", { actual: 170, system: 184 })).toBe(170);
    expect(tpShortcut("all_real", { actual: 5, system: null })).toBeNull();
  });
  it("formats", () => {
    expect(fmtPct(49.09)).toBe("49.09%"); expect(fmtPct(null)).toBe("—");
    expect(fmtOver(21)).toBe("+21 (over-count)"); expect(fmtOver(-8)).toBe("-8 (under-count)"); expect(fmtOver(0)).toBe("0");
  });
});

describe("per-marking TP form", () => {
  it("round-trips, skips blanks and rejects non-numbers", () => {
    const f = toTypeTpForm({ "7": 3, "9": 0 });
    expect(f).toEqual({ 7: "3", 9: "0" });
    expect(parseTypeTpForm({ ...f, 11: "" }).values).toEqual({ "7": 3, "9": 0 });
    expect(parseTypeTpForm({ 7: "1.5", 9: "2" })).toEqual({ values: { "9": 2 }, errors: { 7: "Whole number, 0 or more" } });
  });
  it("compares forms ignoring missing vs blank", () => {
    expect(SAME_TYPES({ 7: "3" }, { 7: "3", 9: "" })).toBe(true);
    expect(SAME_TYPES({ 7: "3" }, { 7: "4" })).toBe(false);
  });
});
