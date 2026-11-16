import type { EvalInputs, EvalMetrics, EvalScalars } from "../api";

export const EVAL_FIELDS: { key: keyof EvalScalars; label: string; hint: string; gender?: boolean }[] = [
  { key: "tp", label: "TP", hint: "Sakshi counts that were real visitors" },
  { key: "gender_assigned", label: "Counts with a gender", hint: "Sakshi counts that got a gender at all", gender: true },
  { key: "real_male_in_tp", label: "Real men in TP", hint: "of the TP, how many really were men", gender: true },
  { key: "real_female_in_tp", label: "Real women in TP", hint: "of the TP, how many really were women", gender: true },
  { key: "correct_male", label: "Men classified correctly", hint: "of the real men in TP", gender: true },
  { key: "correct_female", label: "Women classified correctly", hint: "of the real women in TP", gender: true },
];

export type EvalForm = Record<keyof EvalScalars, string>;
const KEYS = EVAL_FIELDS.map((f) => f.key);

export const toEvalForm = (i: EvalScalars): EvalForm =>
  Object.fromEntries(KEYS.map((k) => [k, i[k] === null ? "" : String(i[k])])) as EvalForm;

/** Blank = not entered (null). Anything else must be a whole number, 0 or more. */
export function parseEvalForm(f: EvalForm): { values: EvalScalars; errors: Partial<Record<keyof EvalScalars, string>> } {
  const values = {} as EvalScalars;
  const errors: Partial<Record<keyof EvalScalars, string>> = {};
  for (const k of KEYS) {
    const v = f[k].trim();
    if (v === "") values[k] = null;
    else if (!/^\d+$/.test(v)) { errors[k] = "Whole number, 0 or more"; values[k] = null; }
    else values[k] = Number(v);
  }
  return { values, errors };
}

/** The two shortcuts: every system count was real (TP = system), or nothing was missed (TP = actual). */
export const tpShortcut = (kind: "all_real" | "nothing_missed", m: Pick<EvalMetrics, "actual" | "system">): number | null =>
  kind === "all_real" ? m.system : m.actual;

export const fmtPct = (v: number | null): string => (v === null ? "—" : `${v.toFixed(2)}%`);
export const fmtNum = (v: number | null): string => (v === null ? "—" : String(v));
export const fmtOver = (v: number | null): string => (v === null ? "—" : v > 0 ? `+${v} (over-count)` : v < 0 ? `${v} (under-count)` : "0");

export const SAME = (a: EvalForm, b: EvalForm) => KEYS.every((k) => a[k].trim() === b[k].trim());

/** TP typed per marking: blank = not entered. Keyed by marking id. */
export type TypeTpForm = Record<number, string>;
export const toTypeTpForm = (tp: EvalInputs["type_tp"]): TypeTpForm => Object.fromEntries(Object.entries(tp).map(([k, v]) => [Number(k), String(v)]));
export function parseTypeTpForm(f: TypeTpForm): { values: Record<string, number>; errors: Record<number, string> } {
  const values: Record<string, number> = {};
  const errors: Record<number, string> = {};
  for (const [k, raw] of Object.entries(f)) {
    const v = raw.trim();
    if (v === "") continue;
    if (!/^\d+$/.test(v)) errors[Number(k)] = "Whole number, 0 or more";
    else values[k] = Number(v);
  }
  return { values, errors };
}
export const SAME_TYPES = (a: TypeTpForm, b: TypeTpForm) => {
  const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...ks].every((k) => (a[Number(k)] ?? "").trim() === (b[Number(k)] ?? "").trim());
};
