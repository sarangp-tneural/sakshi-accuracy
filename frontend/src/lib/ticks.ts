/** Position of a time on the seek bar as 0..100 %, clamped. */
export function tickPercent(time: number, duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(100, Math.max(0, (time / duration) * 100));
}

/** Order for the marks list: pending (temp, negative ids, newest has the smallest id) first, then saved newest-first. */
export function newestFirst<T extends { id: number }>(marks: T[]): T[] {
  const pending = marks.filter((m) => m.id < 0).sort((a, b) => a.id - b.id);
  const saved = marks.filter((m) => m.id > 0).sort((a, b) => b.id - a.id);
  return [...pending, ...saved];
}
