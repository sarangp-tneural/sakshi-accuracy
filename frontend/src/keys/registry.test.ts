import { describe, expect, it } from "vitest";
import {
  ACTIONS, DEFAULT_BINDINGS, findConflict, hasDuplicates, isBindable, keyLabel, mergeWithDefaults,
  rebind, resetAll, resetOne, swap,
} from "./registry";

describe("registry", () => {
  it("defaults are complete and unique", () => {
    expect(Object.keys(DEFAULT_BINDINGS)).toHaveLength(ACTIONS.length);
    expect(hasDuplicates(DEFAULT_BINDINGS)).toBe(false);
    expect(DEFAULT_BINDINGS.jump_back).toBe("KeyX");
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
    expect(findConflict(DEFAULT_BINDINGS, "jump_back", "KeyZ")).toBe("undo");
    expect(findConflict(DEFAULT_BINDINGS, "jump_back", "KeyX")).toBeNull();
    expect(findConflict(DEFAULT_BINDINGS, "jump_back", "KeyQ")).toBeNull();
  });
  it("rebind refuses duplicates", () => {
    const r = rebind(DEFAULT_BINDINGS, "jump_back", "KeyZ");
    expect(r).toEqual({ ok: false, reason: "conflict", with: "undo" });
    const ok = rebind(DEFAULT_BINDINGS, "jump_back", "KeyQ");
    expect(ok.ok && ok.bindings.jump_back).toBe("KeyQ");
    expect(rebind(DEFAULT_BINDINGS, "jump_back", "Tab")).toEqual({ ok: false, reason: "not_bindable" });
  });
  it("swap exchanges keys with no duplicates", () => {
    const s = swap(DEFAULT_BINDINGS, "jump_back", "KeyZ");
    expect(s.jump_back).toBe("KeyZ");
    expect(s.undo).toBe("KeyX");
    expect(hasDuplicates(s)).toBe(false);
  });
  it("reset one swaps if default is taken", () => {
    const changed = { ...DEFAULT_BINDINGS, jump_back: "KeyQ", undo: "KeyX" };
    const r = resetOne(changed, "jump_back");
    expect(r.jump_back).toBe("KeyX");
    expect(r.undo).toBe("KeyQ");
    expect(hasDuplicates(r)).toBe(false);
    expect(resetAll()).toEqual(DEFAULT_BINDINGS);
  });
  it("merge fills missing actions from defaults", () => {
    const m = mergeWithDefaults({ jump_back: "KeyQ" });
    expect(m.jump_back).toBe("KeyQ");
    expect(m.undo).toBe("KeyZ");
    expect(Object.keys(m)).toHaveLength(ACTIONS.length);
    expect(mergeWithDefaults(null)).toEqual(DEFAULT_BINDINGS);
    expect(mergeWithDefaults({ jump_back: "KeyZ" })).toEqual(DEFAULT_BINDINGS); // collision -> defaults
  });
});
