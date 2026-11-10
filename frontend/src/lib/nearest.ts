/** Index of the value in ascending `times` closest to `t`, or -1 if empty / farther than maxDist. */
export function nearestIndex(times: number[], t: number, maxDist = Infinity): number {
  const n = times.length;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  let best = lo;
  if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) best = lo - 1; // tie -> earlier
  return Math.abs(times[best] - t) <= maxDist ? best : -1;
}
