/** Zoom and pan of the picture area. Pure maths so the clamping rules are testable.
 *  Adapted from sakshi-accuracy-automation (lib/viewport.ts). The transform is `translate(tx,ty) scale(scale)`
 *  with origin 0 0 on a layer that fills the stage. */
export interface Transform { scale: number; tx: number; ty: number }
export const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };
export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps the zoomed content covering the whole viewport (no empty borders). */
export function clampTransform(t: Transform, w: number, h: number): Transform {
  const scale = clamp(t.scale, MIN_SCALE, MAX_SCALE);
  return { scale, tx: clamp(t.tx, w - w * scale, 0), ty: clamp(t.ty, h - h * scale, 0) };
}

/** Zoom by `factor` keeping the viewport point (px, py) fixed under the cursor. */
export function zoomAt(t: Transform, factor: number, px: number, py: number, w: number, h: number): Transform {
  const scale = clamp(t.scale * factor, MIN_SCALE, MAX_SCALE);
  const k = scale / t.scale;
  return clampTransform({ scale, tx: px - (px - t.tx) * k, ty: py - (py - t.ty) * k }, w, h);
}

export function panBy(t: Transform, dx: number, dy: number, w: number, h: number): Transform {
  return clampTransform({ ...t, tx: t.tx + dx, ty: t.ty + dy }, w, h);
}
