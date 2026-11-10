import { describe, expect, it } from "vitest";
import {
  ACTIONS, DEFAULT_BINDINGS, findConflict, hasDuplicates, isBindable, keyLabel, mergeWithDefaults,
  rebind, resetAll, resetOne, swap,
} from "./registry";

describe("registry", () => {
  it("defaults are complete and unique", () => {
    expect(Object.keys(DEFAULT_BINDINGS)).toHaveLength(ACTIONS.length);
    expect(hasDuplicates(DEFAULT_BINDINGS)).toBe(false);
    expect(DEFAULT_BINDINGS.male_in).toBe("KeyF");
  });
  it("friendly labels", () => {
    expect(keyLabel("KeyF")).toBe("F");
    expect(keyLabel("Space")).toBe("Space");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("Digit1")).toBe("1");
  });
  it("rejects forbidden keys", () => {
    for (const k of ["Tab", "Escape", "Enter", "ShiftLeft", "ControlRight", "AltLeft", "MetaLeft"]) expect(isBindable(k)).toBe(false);
    expect(isBindable("KeyQ")).toBe(true);
  });
  it("detects conflicts", () => {
    expect(findConflict(DEFAULT_BINDINGS, "male_in", "KeyD")).toBe("male_out");
    expect(findConflict(DEFAULT_BINDINGS, "male_in", "KeyF")).toBeNull();
    expect(findConflict(DEFAULT_BINDINGS, "male_in", "KeyQ")).toBeNull();
  });
  it("rebind refuses duplicates", () => {
    const r = rebind(DEFAULT_BINDINGS, "male_in", "KeyD");
    expect(r).toEqual({ ok: false, reason: "conflict", with: "male_out" });
    const ok = rebind(DEFAULT_BINDINGS, "male_in", "KeyQ");
    expect(ok.ok && ok.bindings.male_in).toBe("KeyQ");
    expect(rebind(DEFAULT_BINDINGS, "male_in", "Tab")).toEqual({ ok: false, reason: "not_bindable" });
  });
  it("swap exchanges keys with no duplicates", () => {
    const s = swap(DEFAULT_BINDINGS, "male_in", "KeyD");
    expect(s.male_in).toBe("KeyD");
    expect(s.male_out).toBe("KeyF");
    expect(hasDuplicates(s)).toBe(false);
  });
  it("reset one swaps if default is taken", () => {
    const changed = { ...DEFAULT_BINDINGS, male_in: "KeyQ", undo: "KeyF" };
    const r = resetOne(changed, "male_in");
    expect(r.male_in).toBe("KeyF");
    expect(r.undo).toBe("KeyQ");
    expect(hasDuplicates(r)).toBe(false);
    expect(resetAll()).toEqual(DEFAULT_BINDINGS);
  });
  it("merge fills missing actions from defaults", () => {
    const m = mergeWithDefaults({ male_in: "KeyQ" });
    expect(m.male_in).toBe("KeyQ");
    expect(m.undo).toBe("KeyZ");
    expect(Object.keys(m)).toHaveLength(ACTIONS.length);
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_BINDINGS);
    expect(mergeWithDefaults({ male_in: "KeyZ" })).toEqual(DEFAULT_BINDINGS); // collision -> defaults
  });
});
