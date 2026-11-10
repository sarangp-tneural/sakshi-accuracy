import type { Transform } from "./viewport";

/** A rectangle in stage pixels (before the zoom transform). */
export interface Rect { x: number; y: number; w: number; h: number }

/** Where the picture really is inside a box when the video uses `object-fit: contain` (letterbox / pillarbox). */
export function containRect(boxW: number, boxH: number, videoW: number, videoH: number): Rect {
  if (!(boxW > 0 && boxH > 0 && videoW > 0 && videoH > 0)) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / videoW, boxH / videoH);
  const w = videoW * s, h = videoH * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Pointer position (relative to the stage's top-left) to a point on the picture, 0..1, with zoom/pan undone.
 *  `inside` tells whether the pointer was on the picture itself (not on the black bars). */
export function stageToNorm(px: number, py: number, pic: Rect, tr: Transform): { x: number; y: number; inside: boolean } {
  const sx = (px - tr.tx) / tr.scale;
  const sy = (py - tr.ty) / tr.scale;
  const nx = (sx - pic.x) / pic.w;
  const ny = (sy - pic.y) / pic.h;
  return { x: clamp01(nx), y: clamp01(ny), inside: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 };
}

/** A point on the picture (0..1) to stage pixels with the zoom/pan applied (for drawing the overlay). */
export function normToStage(nx: number, ny: number, pic: Rect, tr: Transform): { x: number; y: number } {
  return { x: tr.tx + tr.scale * (pic.x + nx * pic.w), y: tr.ty + tr.scale * (pic.y + ny * pic.h) };
}
