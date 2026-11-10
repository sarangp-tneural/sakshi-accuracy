// Single registry of actions + default bindings. Legend, handlers and rebinding UI all read from here.
// The action list itself lives in shared/actions.json so the server validates against the same names.
import spec from "../../../shared/actions.json";

export type ActionName = (typeof spec.actions)[number]["name"];
export type Bindings = Record<string, string>;

export interface ActionDef {
  name: ActionName;
  label: string;
  group: "count" | "player";
  default: string;
}

export const ACTIONS = spec.actions as ActionDef[];
export const DEFAULT_BINDINGS: Bindings = Object.fromEntries(ACTIONS.map((a) => [a.name, a.default]));

/** What each counting action records. */
export const COUNT_ACTIONS: Record<string, { direction: "in" | "out"; gender: "male" | "female" | "unknown"; popup: string }> = {
  male_in: { direction: "in", gender: "male", popup: "MALE IN" },
  male_out: { direction: "out", gender: "male", popup: "MALE OUT" },
  female_in: { direction: "in", gender: "female", popup: "FEMALE IN" },
  female_out: { direction: "out", gender: "female", popup: "FEMALE OUT" },
  in_unknown: { direction: "in", gender: "unknown", popup: "IN" },
  out_unknown: { direction: "out", gender: "unknown", popup: "OUT" },
};

export const SPEEDS: Record<string, number> = { speed_1: 1, speed_2: 2, speed_3: 3, speed_4: 4 };

const FORBIDDEN = new Set([
  "Tab", "Escape", "Enter", "NumpadEnter", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
  "AltLeft", "AltRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight", "CapsLock", "ContextMenu", "Fn",
]);
const ALLOWED =
  /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Arrow(Left|Right|Up|Down)|Space|Backspace|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|NumpadAdd|NumpadSubtract|NumpadMultiply|NumpadDivide|NumpadDecimal|Home|End|PageUp|PageDown|Insert|Delete)$/;

export function isBindable(code: string): boolean {
  return !FORBIDDEN.has(code) && ALLOWED.test(code);
}

/** Friendly label for a physical key code. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  const map: Record<string, string> = {
    Space: "Space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Minus: "-", Equal: "=",
    BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",",
    Period: ".", Slash: "/", Backquote: "`",
  };
  return map[code] ?? code;
}

export function labelOf(action: string): string {
  return ACTIONS.find((a) => a.name === action)?.label ?? action;
}

/** Fill missing actions from defaults, drop unknown ones. Falls back to defaults on any conflict. */
export function mergeWithDefaults(saved: Bindings | null | undefined): Bindings {
  const merged: Bindings = {};
  for (const a of ACTIONS) merged[a.name] = saved?.[a.name] || a.default;
  const codes = Object.values(merged);
  if (new Set(codes).size !== codes.length || !codes.every(isBindable)) return { ...DEFAULT_BINDINGS };
  return merged;
}

/** Which other action (if any) already uses `code`. */
export function findConflict(bindings: Bindings, action: string, code: string): string | null {
  return Object.keys(bindings).find((a) => a !== action && bindings[a] === code) ?? null;
}

export type RebindResult =
  | { ok: true; bindings: Bindings }
  | { ok: false; reason: "not_bindable" }
  | { ok: false; reason: "conflict"; with: string };

/** Try to bind `code` to `action`. Never returns a set with duplicates. */
export function rebind(bindings: Bindings, action: string, code: string): RebindResult {
  if (!isBindable(code)) return { ok: false, reason: "not_bindable" };
  if (bindings[action] === code) return { ok: true, bindings };
  const other = findConflict(bindings, action, code);
  if (other) return { ok: false, reason: "conflict", with: other };
  return { ok: true, bindings: { ...bindings, [action]: code } };
}

/** Give `action` the key `code`, and hand `action`'s old key to the action that held `code`. */
export function swap(bindings: Bindings, action: string, code: string): Bindings {
  const other = findConflict(bindings, action, code);
  if (!other) return { ...bindings, [action]: code };
  return { ...bindings, [action]: code, [other]: bindings[action] };
}

/** Reset one action to its default (swapping if another action holds that default). */
export function resetOne(bindings: Bindings, action: string): Bindings {
  return swap(bindings, action, DEFAULT_BINDINGS[action]);
}

export const resetAll = (): Bindings => ({ ...DEFAULT_BINDINGS });

export function hasDuplicates(b: Bindings): boolean {
  const v = Object.values(b);
  return new Set(v).size !== v.length;
}
