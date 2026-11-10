import { fmtClock, recordingProgress } from "./format";
import { MAX_MINUTES, validateRtsp } from "./rtsp";

export const PRESET_MINUTES = [5, 10, 15, 30, 45, 60, 90, 120] as const;
export const QUICK_MINUTES = [5, 15, 30, 60] as const;
export const MAX_NAME = 100;

/** The lengths offered next to Start: the presets plus the camera's own default if it is not one of them. */
export function lengthOptions(defaultMinutes: number): number[] {
  const set = new Set<number>(PRESET_MINUTES);
  if (Number.isInteger(defaultMinutes) && defaultMinutes >= 1 && defaultMinutes <= MAX_MINUTES) set.add(defaultMinutes);
  return [...set].sort((a, b) => a - b);
}

export const startLabel = (minutes: number) => `Start recording · ${minutes} min`;

export interface CameraForm { name: string; url: string; minutes: number }
export interface CameraErrors { name?: string; url?: string; minutes?: string }

/** Add: name, link and length are required. Edit: an empty link means "keep the saved one". */
export function validateCamera(f: CameraForm, editing: boolean): CameraErrors {
  const e: CameraErrors = {};
  const name = f.name.trim();
  if (!name) e.name = "Give the camera a name";
  else if (name.length > MAX_NAME) e.name = `Max ${MAX_NAME} characters`;
  const r = validateRtsp(editing && !f.url.trim() ? "rtsp://keep" : f.url, f.minutes);
  if (r.url) e.url = r.url;
  if (r.minutes) e.minutes = r.minutes;
  return e;
}

/** "12:03 / 30:00" for a running recording, "starting…" before ffmpeg has started. */
export function recordingText(startedAt: string | null, minutes: number | null, nowMs: number): string {
  if (!startedAt || !minutes) return "starting…";
  const p = recordingProgress(startedAt, minutes, nowMs);
  return `${fmtClock(p.elapsed)} / ${fmtClock(p.total)}`;
}
