/** Virtual reference lines: normalised 0..1 coordinates of the picture, so they survive any resolution or zoom. */
export interface VirtualLine { id: string; name: string; x1: number; y1: number; x2: number; y2: number; color: string }

export const MAX_LINES = 20;
export const MAX_LINE_NAME = 40;
export const LINE_COLORS = ["#ffcc00", "#ff4d4d", "#4dd2ff", "#7dff6b", "#ff7ad9", "#ffffff"];
/** A drag shorter than this (fraction of the picture) is a stray click, not a line. */
export const MIN_LINE_LEN = 0.02;
export const ENDPOINT_PX = 12;
export const BODY_PX = 7;

export type Part = "p1" | "p2" | "body";
export interface Px { w: number; h: number } // size of the drawn picture in pixels

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function makeId(): string {
  return "l" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function nextColor(lines: VirtualLine[]): string {
  return LINE_COLORS[lines.length % LINE_COLORS.length];
}

export function nextName(lines: VirtualLine[]): string {
  const used = new Set(lines.map((l) => l.name));
  for (let i = lines.length + 1; ; i++) if (!used.has(`Line ${i}`)) return `Line ${i}`;
}

export function newLine(lines: VirtualLine[], x: number, y: number): VirtualLine {
  return { id: makeId(), name: nextName(lines), x1: clamp01(x), y1: clamp01(y), x2: clamp01(x), y2: clamp01(y), color: nextColor(lines) };
}

export function lineLength(l: VirtualLine): number {
  return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
}

/** Distance in pixels from point p to segment a-b. */
export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** What is under the pointer (normalised x, y)? Endpoints win over the body; later lines (drawn on top) win over earlier ones. */
export function hitTest(lines: VirtualLine[], x: number, y: number, size: Px): { id: string; part: Part } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const p = (nx: number, ny: number) => Math.hypot((nx - x) * size.w, (ny - y) * size.h);
    if (p(l.x1, l.y1) <= ENDPOINT_PX) return { id: l.id, part: "p1" };
    if (p(l.x2, l.y2) <= ENDPOINT_PX) return { id: l.id, part: "p2" };
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (distToSegment(x * size.w, y * size.h, l.x1 * size.w, l.y1 * size.h, l.x2 * size.w, l.y2 * size.h) <= BODY_PX) return { id: l.id, part: "body" };
  }
  return null;
}

/** Move one endpoint, or the whole line by (dx, dy) without letting it leave the picture. */
export function dragLine(l: VirtualLine, part: Part, x: number, y: number, dx = 0, dy = 0): VirtualLine {
  if (part === "p1") return { ...l, x1: clamp01(x), y1: clamp01(y) };
  if (part === "p2") return { ...l, x2: clamp01(x), y2: clamp01(y) };
  const mx = Math.min(l.x1, l.x2), Mx = Math.max(l.x1, l.x2), my = Math.min(l.y1, l.y2), My = Math.max(l.y1, l.y2);
  const sx = Math.min(1 - Mx, Math.max(-mx, dx)), sy = Math.min(1 - My, Math.max(-my, dy));
  return { ...l, x1: l.x1 + sx, x2: l.x2 + sx, y1: l.y1 + sy, y2: l.y2 + sy };
}

/** Pointer position (client px) to a point on the picture, 0..1, given the picture's on-screen box. */
export function clientToNorm(cx: number, cy: number, box: { left: number; top: number; width: number; height: number }): { x: number; y: number } {
  return { x: clamp01((cx - box.left) / (box.width || 1)), y: clamp01((cy - box.top) / (box.height || 1)) };
}

/** Where the picture's overlay sits inside the stage once zoom/pan is applied (all in stage pixels). */
export function overlayRect(pic: { x: number; y: number; w: number; h: number }, tr: { tx: number; ty: number; scale: number }) {
  return { x: tr.tx + tr.scale * pic.x, y: tr.ty + tr.scale * pic.y, w: tr.scale * pic.w, h: tr.scale * pic.h };
}
