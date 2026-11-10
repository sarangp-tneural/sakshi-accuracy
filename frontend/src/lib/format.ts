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

/** "10 Nov 2026, 06:17:31 PM": date and time with seconds, in the viewer's locale. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** "38.6 MB". */
export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

const CODECS: Record<string, string> = { h264: "H.264", hevc: "H.265", mpeg4: "MPEG-4", vp9: "VP9", av1: "AV1", mjpeg: "MJPEG" };
/** "1920×1080 · 25 fps · H.264" with whatever is known. */
export function fmtStream(w: number | null, h: number | null, fps: number | null, codec: string | null): string {
  const parts: string[] = [];
  if (w && h) parts.push(`${w}×${h}`);
  if (fps) parts.push(`${Number.isInteger(fps) ? fps : fps.toFixed(1)} fps`);
  if (codec) parts.push(CODECS[codec] ?? codec.toUpperCase());
  return parts.length ? parts.join(" · ") : "—";
}

/** "10 Nov, 18:17": compact date and time for table cells. */
export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
