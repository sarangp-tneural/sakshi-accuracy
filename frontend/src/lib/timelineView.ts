/** The visible window of the timeline. Adapted from sakshi-accuracy-automation (lib/timeline.ts view maths). */
export interface View { start: number; end: number }
export const MIN_SPAN = 2; // seconds

export const fullView = (duration: number): View => ({ start: 0, end: Math.max(duration, MIN_SPAN) });
export const timeToX = (t: number, v: View, width: number) => ((t - v.start) / (v.end - v.start)) * width;
export const xToTime = (x: number, v: View, width: number) => v.start + (x / width) * (v.end - v.start);

function shiftInto(v: View, duration: number): View {
  const span = v.end - v.start;
  const max = Math.max(duration, MIN_SPAN);
  const start = Math.min(Math.max(0, v.start), Math.max(0, max - span));
  return { start, end: start + span };
}

/** Zoom by `factor` (>1 zooms in) around time `anchor`, staying inside [0, duration]. */
export function zoomView(v: View, duration: number, factor: number, anchor: number): View {
  const span = Math.min(Math.max((v.end - v.start) / factor, MIN_SPAN), Math.max(duration, MIN_SPAN));
  const ratio = (anchor - v.start) / (v.end - v.start);
  return shiftInto({ start: anchor - ratio * span, end: anchor - ratio * span + span }, duration);
}

export const panView = (v: View, duration: number, dt: number): View => shiftInto({ start: v.start + dt, end: v.end + dt }, duration);

/** Same span, moved so time `t` is visible (centred when it was outside). */
export function ensureVisible(v: View, duration: number, t: number): View {
  if (t >= v.start && t <= v.end) return v;
  const span = v.end - v.start;
  return shiftInto({ start: t - span / 2, end: t + span / 2 }, duration);
}

const STEPS = [0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600];
/** Ruler tick spacing in seconds so labels are at least `minPx` apart. */
export function rulerStep(span: number, width: number, minPx = 64): number {
  return STEPS.find((s) => (s / span) * width >= minPx) ?? STEPS[STEPS.length - 1];
}

/** [lo, hi) indices of the items of an ascending list of times that fall inside the view (plus `pad` seconds). */
export function visibleSlice(times: number[], v: View, pad = 0): [number, number] {
  const lower = (x: number) => { let lo = 0, hi = times.length; while (lo < hi) { const m = (lo + hi) >> 1; if (times[m] < x) lo = m + 1; else hi = m; } return lo; };
  return [lower(v.start - pad), lower(v.end + pad + 1e-9)];
}

type Row = { in: number; out: number; other: number };
type Item = { time_s: number; direction: "in" | "out" | null };

/** Vertical offset of stack lane `lane`: 0, +step, -step, +2·step, -2·step ... so a stack stays centred on its row. */
export const laneOffset = (lane: number, step = 13) => (lane === 0 ? 0 : (lane % 2 === 1 ? 1 : -1) * Math.ceil(lane / 2) * step);

/** Marker centre y for every item (index-aligned; only items in the view are filled in). Markers on the same row that would
 *  overlap horizontally (closer than `gapPx`) are stacked on separate lanes above/below the row line; y stays within [minY, maxY]. */
export function layoutY(items: Item[], v: View, width: number, rowY: Row, minY: number, maxY: number, gapPx = 14, step = 13): number[] {
  const ys = items.map((m) => rowY[m.direction ?? "other"]);
  const [lo, hi] = visibleSlice(items.map((m) => m.time_s), v, 0.5);
  const lanes: Record<string, number[]> = { in: [], out: [], other: [] }; // last x per lane, per row
  for (let i = lo; i < hi; i++) {
    const key = items[i].direction ?? "other", x = timeToX(items[i].time_s, v, width), last = lanes[key];
    let lane = last.findIndex((lx) => x - lx >= gapPx);
    if (lane < 0) lane = last.length;
    last[lane] = x;
    ys[i] = Math.min(Math.max(rowY[key] + laneOffset(lane, step), minY), maxY);
  }
  return ys;
}

/** Nearest marker (index into `items`) within `radius` px of the pointer. IN markers sit on one row, OUT on another, marks without a direction on a middle row.
 *  `ys` (from layoutY) gives each marker's actual y when stacked. */
export function hitMarker(items: Item[], v: View, width: number, px: number, py: number,
  rowY: Row, radius = 10, ys?: number[]): number {
  const [lo, hi] = visibleSlice(items.map((m) => m.time_s), v, 0);
  let best = -1, bd = radius;
  for (let i = lo; i < hi; i++) {
    const d = Math.hypot(timeToX(items[i].time_s, v, width) - px, (ys ? ys[i] : rowY[items[i].direction ?? "other"]) - py);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
