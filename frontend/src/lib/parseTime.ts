/** "83", "83.5", "1:23", "1:23.5" or "1:02:03" to seconds; null when it isn't a time. */
export function parseTime(input: string): number | null {
  const parts = input.trim().split(":");
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
