export const MAX_MINUTES = 120;

/** Same rules as the server: rtsp(s):// link and a whole number of minutes from 1 to 120. */
export function validateRtsp(url: string, minutes: number): { url?: string; minutes?: string } {
  const e: { url?: string; minutes?: string } = {};
  const u = url.trim();
  if (!u) e.url = "Enter the stream link";
  else if (!/^rtsps?:\/\//i.test(u)) e.url = "Link must start with rtsp:// or rtsps://";
  else if (/\s/.test(u)) e.url = "Link must not contain spaces";
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES) e.minutes = `Whole minutes, 1 to ${MAX_MINUTES}`;
  return e;
}
