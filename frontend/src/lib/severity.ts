import type { Metric } from "./format";

/** |difference| as a % of manual: up to `good` = close, up to `warn` = notable, above = large. */
export const SEVERITY_THRESHOLDS = { good: 5, warn: 15 } as const;
export type Severity = "good" | "warn" | "bad";

/** null when Sakshi is not entered (no judgement possible). */
export function severityOf(m: Metric): Severity | null {
  if (m.status === "not_entered" || m.diff === null) return null;
  if (m.diff === 0) return "good";
  if (m.percent === null) return "bad"; // manual is 0 but Sakshi is not: percentage undefined, still a mismatch
  const p = Math.abs(m.percent);
  if (p <= SEVERITY_THRESHOLDS.good) return "good";
  if (p <= SEVERITY_THRESHOLDS.warn) return "warn";
  return "bad";
}

export const SEVERITY_LABEL: Record<Severity, { icon: string; text: string }> = {
  good: { icon: "✓", text: "close" },
  warn: { icon: "!", text: "notable" },
  bad: { icon: "✕", text: "large" },
};
