import { describe, expect, it } from "vitest";
import { markTime } from "./reaction";
import { decideKey, nextRepeat } from "./keyEvents";
import { fmtDiff, fmtPercent } from "./format";
import { DEFAULT_BINDINGS } from "../keys/registry";

const ev = (code: string, extra = {}) => ({ code, repeat: false, ctrlKey: false, altKey: false, metaKey: false, target: { tagName: "BODY" }, ...extra });

describe("markTime", () => {
  it("subtracts delay scaled by speed", () => {
    expect(markTime(10, 0.4, 1)).toBeCloseTo(9.6);
    expect(markTime(10, 0.4, 4)).toBeCloseTo(8.4);
  });
  it("clamps to 0", () => {
    expect(markTime(0.5, 0.4, 4)).toBe(0);
    expect(markTime(0, 0.4, 1)).toBe(0);
  });
  it("zero delay is identity", () => expect(markTime(7, 0, 4)).toBe(7));
});

describe("decideKey", () => {
  it("maps bound keys by physical code", () => expect(decideKey(ev("KeyF"), DEFAULT_BINDINGS, { capturing: false })).toEqual({ type: "action", action: "male_in" }));
  it("ignores unbound keys", () => expect(decideKey(ev("KeyQ"), DEFAULT_BINDINGS, { capturing: false })).toEqual({ type: "ignore" }));
  it("ignores held keys but swallows them", () => expect(decideKey(ev("KeyF", { repeat: true }), DEFAULT_BINDINGS, { capturing: false })).toEqual({ type: "swallow" }));
  it("ignores while typing in inputs", () => {
    expect(decideKey(ev("KeyF", { target: { tagName: "INPUT" } }), DEFAULT_BINDINGS, { capturing: false })).toEqual({ type: "ignore" });
    expect(decideKey(ev("KeyF", { target: { tagName: "DIV", isContentEditable: true } }), DEFAULT_BINDINGS, { capturing: false })).toEqual({ type: "ignore" });
  });
  it("ignores while capturing a new key", () => expect(decideKey(ev("KeyF"), DEFAULT_BINDINGS, { capturing: true })).toEqual({ type: "ignore" }));
  it("ignores browser shortcuts with modifiers", () => expect(decideKey(ev("KeyZ", { ctrlKey: true }), DEFAULT_BINDINGS, { capturing: false })).toEqual({ type: "ignore" }));
});

describe("nextRepeat", () => {
  it("counts quick repeats of the same action", () => {
    const a = nextRepeat(null, "male_in", 0);
    const b = nextRepeat(a, "male_in", 500);
    expect(b.n).toBe(2);
    expect(nextRepeat(b, "male_in", 900).n).toBe(3);
  });
  it("resets for other action or after the window", () => {
    const a = nextRepeat(null, "male_in", 0);
    expect(nextRepeat(a, "male_out", 100).n).toBe(1);
    expect(nextRepeat(a, "male_in", 5000).n).toBe(1);
  });
});

describe("format", () => {
  it("blank vs zero vs undefined percent", () => {
    expect(fmtDiff({ manual: 5, sakshi: null, diff: null, percent: null, status: "not_entered" })).toBe("not entered");
    expect(fmtDiff({ manual: 5, sakshi: 0, diff: -5, percent: -100, status: "ok" })).toBe("-5");
    expect(fmtPercent({ manual: 0, sakshi: 3, diff: 3, percent: null, status: "undefined" })).toBe("not defined");
    expect(fmtPercent({ manual: 10, sakshi: 12, diff: 2, percent: 20, status: "ok" })).toBe("+20.0%");
  });
});
