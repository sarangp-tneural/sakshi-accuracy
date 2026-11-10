/** One definition of what direction/gender look like everywhere (badges, popup, legend, ticks). */
export type Direction = "in" | "out";
export type Gender = "male" | "female" | "unknown";

export const DIRECTION_META: Record<Direction, { label: string; icon: string; cssVar: string }> = {
  in: { label: "IN", icon: "▲", cssVar: "--in" },
  out: { label: "OUT", icon: "▼", cssVar: "--out" },
};

export const GENDER_META: Record<Gender, { label: string; short: string; icon: string; cssVar: string }> = {
  male: { label: "Male", short: "M", icon: "♂", cssVar: "--male" },
  female: { label: "Female", short: "F", icon: "♀", cssVar: "--female" },
  unknown: { label: "Unknown", short: "?", icon: "?", cssVar: "--unknown" },
};
