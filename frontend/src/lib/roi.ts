import type { Roi } from "../api";

export const MIN_ROI = 0.03; // smallest side (the server needs more than 0.02)
export type RoiPart = "nw" | "ne" | "sw" | "se" | "body";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The rectangle spanned by two corner points (any direction), kept at least MIN_ROI wide and high and inside the picture. */
export function rectFromDrag(ax: number, ay: number, bx: number, by: number): Roi {
  let x = Math.min(ax, bx), y = Math.min(ay, by);
  const w = Math.min(1, Math.max(MIN_ROI, Math.abs(bx - ax))), h = Math.min(1, Math.max(MIN_ROI, Math.abs(by - ay)));
  x = Math.min(x, 1 - w); y = Math.min(y, 1 - h);
  return { x: clamp01(x), y: clamp01(y), w, h };
}

/** Move the whole rectangle by (dx, dy), staying inside the picture. */
export function moveRect(r: Roi, dx: number, dy: number): Roi {
  return { ...r, x: Math.min(1 - r.w, Math.max(0, r.x + dx)), y: Math.min(1 - r.h, Math.max(0, r.y + dy)) };
}

/** Drag one corner to (px, py); the opposite corner stays put. */
export function resizeRect(r: Roi, part: Exclude<RoiPart, "body">, px: number, py: number): Roi {
  const ax = part.endsWith("w") ? r.x + r.w : r.x; // the fixed corner
  const ay = part.startsWith("n") ? r.y + r.h : r.y;
  return rectFromDrag(ax, ay, px, py);
}

/** Which part of the rectangle is under (px, py)? Corner handles win over the body; `tol` is in 0..1 units. */
export function hitRoi(r: Roi, px: number, py: number, tolX: number, tolY: number): RoiPart | null {
  const corners: [RoiPart, number, number][] = [["nw", r.x, r.y], ["ne", r.x + r.w, r.y], ["sw", r.x, r.y + r.h], ["se", r.x + r.w, r.y + r.h]];
  for (const [p, cx, cy] of corners) if (Math.abs(px - cx) <= tolX && Math.abs(py - cy) <= tolY) return p;
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h ? "body" : null;
}
