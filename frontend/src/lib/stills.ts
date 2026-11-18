/** Still moments: the server finds the frames worth looking at (see backend/app/stills.py). These helpers only read that list. */

export interface Keyframes {
  kept: number[]; // ascending seconds
  duration_s: number;
  sample_fps: number;
  reviewed_s: number;
  saved_s: number;
}

const EPS = 0.05; // a kept frame closer than this to the current time counts as "here"

/** The next kept moment after `t`, or null at the end. */
export function nextKept(kept: number[], t: number): number | null {
  let lo = 0, hi = kept.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (kept[m] > t + EPS) hi = m; else lo = m + 1; }
  return lo < kept.length ? kept[lo] : null;
}

/** The kept moment before `t`, or null at the start. */
export function prevKept(kept: number[], t: number): number | null {
  let lo = 0, hi = kept.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (kept[m] < t - EPS) lo = m + 1; else hi = m; }
  return lo > 0 ? kept[lo - 1] : null;
}

/** The spans between kept moments that are skipped (a gap of more than two samples), for shading the timeline. */
export function stillSpans(kept: number[], duration: number, sampleFps: number): [number, number][] {
  const dt = 1 / sampleFps, out: [number, number][] = [];
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i] + dt, b = i + 1 < kept.length ? kept[i + 1] : duration;
    if (b - a > dt) out.push([a, b]);
  }
  return out;
}

const mmss = (s: number) => { const t = Math.max(0, Math.round(s)), m = Math.floor(t / 60); return `${m}:${String(t % 60).padStart(2, "0")}`; };

/** "30:00 → 6:00" */
export function savedLabel(k: Pick<Keyframes, "duration_s" | "reviewed_s">): string {
  return `${mmss(k.duration_s)} → ${mmss(k.reviewed_s)}`;
}
