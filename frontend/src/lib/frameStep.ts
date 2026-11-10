/** Median of the measured gaps between displayed frames (recordings can be variable frame rate); null if too few. */
export function medianGap(gaps: number[]): number | null {
  if (gaps.length < 3) return null;
  const g = [...gaps].sort((a, b) => a - b);
  return g[g.length >> 1];
}

/** Time to seek to when stepping `frames` frames (default 1): the middle of the target frame, so rounding never lands on the same frame. */
export function stepTarget(t: number, step: number, dir: 1 | -1, frames = 1): number {
  const current = Math.floor(t / step + 1e-6);
  return Math.max(0, (current + dir * Math.max(1, Math.round(frames)) + 0.5) * step);
}

/** Is this measured gap between two presented frames plausibly ONE frame? Seek jumps and stalls are not.
 *  `nominal` is the frame time from the container's fps (null/0 when unknown: then only a loose sanity range applies). */
export function plausibleFrameGap(gap: number, nominal: number | null): boolean {
  if (!(gap > 0) || gap >= 0.5) return false;
  if (!nominal || nominal <= 0) return true;
  return gap >= nominal * 0.4 && gap <= nominal * 2.5;
}
