import type { Project } from "../api";

const MIN = 60, HOUR = 3600, DAY = 86400;

/** "just now", "5 min ago", "2 h ago", "3 days ago", or the date for anything older than a month. */
export function fmtAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, (nowMs - t) / 1000); // a clock a little ahead of the server still reads "just now"
  if (s < 45) return "just now";
  if (s < HOUR) return `${Math.max(1, Math.round(s / MIN))} min ago`;
  if (s < DAY) return `${Math.round(s / HOUR)} h ago`;
  if (s < 30 * DAY) { const d = Math.round(s / DAY); return d === 1 ? "yesterday" : `${d} days ago`; }
  return new Date(t).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

/** Total recorded/uploaded video time: "—", "<1 min", "47 min", "1 h 32 min". */
export function fmtTotalDuration(seconds: number): string {
  if (!(seconds > 0)) return "—";
  if (seconds < MIN) return "<1 min";
  const mins = Math.round(seconds / MIN);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}

/** Share of videos compared with Sakshi, 0..100 (0 when there are no videos). */
export function comparedPct(compared: number, videos: number): number {
  if (videos <= 0) return 0;
  return Math.min(100, Math.round((compared / videos) * 100));
}

export interface StateBadge { key: "recording" | "connecting" | "processing" | "failed"; label: string; n: number }
/** Only the states that need attention, in order of importance; empty when everything is idle. */
export function stateBadges(p: Pick<Project, "recording_count" | "connecting_count" | "processing_count" | "failed_count">): StateBadge[] {
  const all: StateBadge[] = [
    { key: "recording", label: "Recording", n: p.recording_count },
    { key: "connecting", label: "Attempting", n: p.connecting_count },
    { key: "processing", label: "Processing", n: p.processing_count },
    { key: "failed", label: "Failed", n: p.failed_count },
  ];
  return all.filter((b) => b.n > 0);
}

/** One-line "what is in here" for screen readers and tooltips. */
export function projectSummary(p: Project): string {
  const v = `${p.video_count} video${p.video_count === 1 ? "" : "s"}`;
  const c = `${p.camera_count} camera${p.camera_count === 1 ? "" : "s"}`;
  const m = `${p.mark_total} mark${p.mark_total === 1 ? "" : "s"}`;
  return `${v}, ${c}, ${m}, ${p.compared_count} of ${p.video_count} compared with Sakshi`;
}
