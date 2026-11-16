import { describe, expect, it } from "vitest";
import type { MarkingType } from "../api";
import { countMarks, keyOwner, markingIdOf, typeColor, withMarkingKeys } from "./markings";

const T = (id: number, direction: MarkingType["direction"], key: string, extra: Partial<MarkingType> = {}): MarkingType =>
  ({ id, project_id: 1, label: `T${id}`, direction, key_code: key, color: null, sort_order: id, archived: false, mark_count: 0, ...extra });

describe("markings", () => {
  const types = [T(1, "in", "KeyF"), T(2, "out", "KeyD"), T(3, null, "KeyB"), T(4, "in", "KeyG", { archived: true })];
  it("adds one key per current marking and skips removed ones", () => {
    const b = withMarkingKeys({ undo: "KeyZ" }, types);
    expect(b).toEqual({ undo: "KeyZ", "mt:1": "KeyF", "mt:2": "KeyD", "mt:3": "KeyB" });
    expect(markingIdOf("mt:3")).toBe(3);
    expect(markingIdOf("undo")).toBeNull();
  });
  it("counts in/out by direction and each marking on its own", () => {
    const marks = [
      { direction: "in" as const, marking_type_id: 1 }, { direction: "in" as const, marking_type_id: 1 },
      { direction: null, marking_type_id: 3 }, { direction: "out" as const, marking_type_id: 2 },
    ];
    const c = countMarks(marks, types);
    expect([c.in, c.out, c.total]).toEqual([2, 1, 4]);
    expect(c.types.map((x) => x.n)).toEqual([2, 1, 1]);
  });
  it("finds who owns a key", () => {
    expect(keyOwner("KeyF", types, { undo: "KeyZ" })).toBe("T1");
    expect(keyOwner("KeyF", types, {}, 1)).toBeNull();
    expect(keyOwner("KeyZ", types, { undo: "KeyZ" })).toBe("undo");
    expect(keyOwner("KeyG", types, {})).toBeNull(); // belongs to a removed marking
  });
  it("colour falls back to the direction", () => {
    expect(typeColor(T(1, "in", "KeyF"))).toBe("var(--in)");
    expect(typeColor(T(1, null, "KeyF", { color: "#00ff00" }))).toBe("#00ff00");
    expect(typeColor(T(1, null, "KeyF"))).toBe("var(--unknown)");
  });
});
