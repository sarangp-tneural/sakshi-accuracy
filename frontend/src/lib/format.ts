/** mm:ss.s (rounded to tenths first so 59.96 becomes 01:00.0, never 00:60.0). */
export function fmtTime(s: number): string {
  const tenths = Math.round(Math.max(0, s || 0) * 10);
  const m = Math.floor(tenths / 600);
  const sec = (tenths - m * 600) / 10;
  return `${String(m).padStart(2, "0")}:${sec.toFixed(1).padStart(4, "0")}`;
}

/** mm:ss for whole seconds (hh:mm:ss past an hour). */
export function fmtClock(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Recording progress from the start time and planned minutes. */
export function recordingProgress(createdAtIso: string, minutes: number, nowMs: number) {
  const total = minutes * 60;
  const elapsed = Math.min(total, Math.max(0, (nowMs - new Date(createdAtIso).getTime()) / 1000));
  return { elapsed, total, pct: total ? (elapsed / total) * 100 : 0 };
}

export interface Metric {
  manual: number;
  sakshi: number | null;
  diff: number | null;
  percent: number | null;
  status: "ok" | "undefined" | "not_entered";
}

export function fmtDiff(m: Metric): string {
  if (m.diff === null) return "not entered";
  return (m.diff > 0 ? "+" : "") + m.diff;
}

export function fmtPercent(m: Metric): string {
  if (m.diff === null) return "—";
  if (m.percent === null) return "not defined";
  return (m.percent > 0 ? "+" : "") + m.percent.toFixed(1) + "%";
}
