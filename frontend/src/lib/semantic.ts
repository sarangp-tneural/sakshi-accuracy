/** What IN / OUT look like everywhere (ticks, legend). Markings use their own colour, falling back to these. */
export type Direction = "in" | "out";

export const DIRECTION_META: Record<Direction, { label: string; icon: string; cssVar: string }> = {
  in: { label: "IN", icon: "▲", cssVar: "--in" },
  out: { label: "OUT", icon: "▼", cssVar: "--out" },
};
