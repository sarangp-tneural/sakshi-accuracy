import type { DashVideo } from "../api";

export type SortKey = "name" | "created" | "actual" | "system" | "off" | "tp" | "precision" | "recall";
export type SortDir = "asc" | "desc";

/** How far Sakshi is from your count, in percent of your count (+ = over-count). Null when it cannot be told. */
export const countOffPct = (actual: number, system: number | null): number | null =>
  system === null || actual === 0 ? null : Math.round(((system - actual) / actual) * 1000) / 10;

const value = (r: DashVideo, k: SortKey): number | string | null => {
  switch (k) {
    case "name": return r.name.toLowerCase();
    case "created": return r.created_at;
    case "actual": return r.actual;
    case "system": return r.system;
    case "off": { const o = countOffPct(r.actual, r.system); return o === null ? null : Math.abs(o); }
    case "tp": return r.tp;
    case "precision": return r.metrics.precision;
    case "recall": return r.metrics.recall;
  }
};

/** Sort rows; rows with no value for the column always go last, in either direction. */
export function sortVideos(rows: DashVideo[], key: SortKey, dir: SortDir): DashVideo[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = value(a, key), y = value(b, key);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * sign;
  });
}

export const matchVideo = (r: DashVideo, q: string): boolean => {
  const t = q.trim().toLowerCase();
  return !t || [r.name, r.project, r.camera ?? "no camera"].some((s) => s.toLowerCase().includes(t));
};

/** A tidy upper bound for a chart axis (1, 2, 5 x 10^n). */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/** Points of a line over `values` (null = a gap) inside a w x h box, y from 0..max. Returns one polyline per run of values. */
export function linePaths(values: (number | null)[], w: number, h: number, max = 100): string[][] {
  const runs: string[][] = [];
  let cur: string[] = [];
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  values.forEach((v, i) => {
    if (v === null) { if (cur.length) runs.push(cur); cur = []; return; }
    const x = values.length > 1 ? i * step : w / 2;
    cur.push(`${x.toFixed(1)},${(h - (Math.min(v, max) / max) * h).toFixed(1)}`);
  });
  if (cur.length) runs.push(cur);
  return runs;
}

export const SEVERITY = {
  bad: { icon: "✕", label: "Problem", cls: "bad" },
  warn: { icon: "!", label: "Check", cls: "warn" },
  info: { icon: "i", label: "Note", cls: "info" },
} as const;

export const PERIODS: { days: number; label: string }[] = [
  { days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 0, label: "All time" },
];

/** "04 Nov" for a yyyy-mm-dd day. */
export function shortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}
