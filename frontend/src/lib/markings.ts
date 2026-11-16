import type { Mark, MarkingType } from "../api";

/** Colour used when a marking has none of its own: the IN/OUT colour, or grey. */
export const FALLBACK_COLOR = { in: "var(--in)", out: "var(--out)", none: "var(--unknown)" } as const;

export const directionIcon = (d: "in" | "out" | null) => (d === "in" ? "▲" : d === "out" ? "▼" : "•");
export const directionText = (d: "in" | "out" | null) => (d === "in" ? "IN" : d === "out" ? "OUT" : "no direction");

/** CSS colour of a marking (its own, else by direction). */
export function typeColor(t: Pick<MarkingType, "color" | "direction"> | undefined): string {
  return t?.color ?? FALLBACK_COLOR[t?.direction ?? "none"];
}

export const activeTypes = (types: MarkingType[]) => types.filter((t) => !t.archived);

export function typesById(types: MarkingType[]): Map<number, MarkingType> {
  return new Map(types.map((t) => [t.id, t]));
}

/** Key bindings for the global handler: player actions plus one "mt:<id>" entry per current marking. */
export const MT_PREFIX = "mt:";
export function withMarkingKeys(player: Record<string, string>, types: MarkingType[]): Record<string, string> {
  const out = { ...player };
  for (const t of types) if (!t.archived) out[MT_PREFIX + t.id] = t.key_code;
  return out;
}
export const markingIdOf = (action: string): number | null => (action.startsWith(MT_PREFIX) ? Number(action.slice(MT_PREFIX.length)) : null);

/** Label of the marking a mark belongs to (a removed marking keeps its label). */
export const markLabel = (m: Pick<Mark, "marking_type_id">, byId: Map<number, MarkingType>) =>
  (m.marking_type_id !== null ? byId.get(m.marking_type_id)?.label : undefined) ?? "Unknown marking";

/** Counts for the counter boxes: IN, OUT, total and one number per current marking. */
export function countMarks(marks: Pick<Mark, "direction" | "marking_type_id">[], types: MarkingType[]) {
  const per = new Map<number, number>();
  let inN = 0, outN = 0;
  for (const m of marks) {
    if (m.direction === "in") inN++; else if (m.direction === "out") outN++;
    if (m.marking_type_id !== null) per.set(m.marking_type_id, (per.get(m.marking_type_id) ?? 0) + 1);
  }
  return { in: inN, out: outN, total: marks.length, types: activeTypes(types).map((t) => ({ type: t, n: per.get(t.id) ?? 0 })) };
}

/** Whether a Count-screen key code is free for a marking (not used by another current marking or a player action). */
export function keyOwner(code: string, types: MarkingType[], player: Record<string, string>, ignoreId?: number): string | null {
  const t = activeTypes(types).find((x) => x.id !== ignoreId && x.key_code === code);
  if (t) return t.label;
  return Object.keys(player).find((a) => player[a] === code) ?? null;
}
