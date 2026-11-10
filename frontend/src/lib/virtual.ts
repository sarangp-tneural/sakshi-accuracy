/** Fixed-row-height windowing: which rows [start, end) to render. */
export function visibleRange(scrollTop: number, viewportH: number, rowH: number, count: number, overscan = 8) {
  if (count <= 0 || rowH <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const last = Math.ceil((Math.max(0, scrollTop) + viewportH) / rowH);
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + overscan) };
}
