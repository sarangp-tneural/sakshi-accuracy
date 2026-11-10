/** Pure decision logic for the global keydown handler (testable without a DOM). */
export interface KeyEventLike {
  code: string;
  repeat: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  target?: object | null;
}

export function isTypingTarget(t: KeyEventLike["target"]): boolean {
  if (!t) return false;
  const el = t as { tagName?: string; isContentEditable?: boolean };
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

export type KeyDecision =
  | { type: "ignore" }
  | { type: "swallow" } // bound key held down: block default, don't act
  | { type: "action"; action: string };

export function decideKey(
  e: KeyEventLike,
  bindings: Record<string, string>,
  opts: { capturing: boolean },
): KeyDecision {
  if (opts.capturing || isTypingTarget(e.target)) return { type: "ignore" };
  if (e.ctrlKey || e.altKey || e.metaKey) return { type: "ignore" };
  const action = Object.keys(bindings).find((a) => bindings[a] === e.code);
  if (!action) return { type: "ignore" };
  if (e.repeat) return { type: "swallow" };
  return { type: "action", action };
}

/** Popup text with ×N when the same action repeats within `windowMs`. */
export function nextRepeat(
  prev: { action: string; at: number; n: number } | null,
  action: string,
  now: number,
  windowMs = 1000,
): { action: string; at: number; n: number } {
  if (prev && prev.action === action && now - prev.at <= windowMs) return { action, at: now, n: prev.n + 1 };
  return { action, at: now, n: 1 };
}
