import { fmtClock, recordingProgress } from "./format";
import { attemptingFor, parseAttempt } from "./videoRow";
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

/** How long a recording may sit at "starting…" before we say the recorder (the Celery worker) has not picked it up. */
export const RECORDER_WAIT_S = 20;
export const RECORDER_HINT = "The recorder has not started this recording yet. Check that the app was started with ./run.sh and that only one worker is running.";

/** True when the recording was requested a while ago but ffmpeg has not started. */
export function waitingForRecorder(startedAt: string | null, createdAt: string | null | undefined, nowMs: number): boolean {
  if (startedAt || !createdAt) return false;
  const t = new Date(createdAt).getTime();
  return !Number.isNaN(t) && (nowMs - t) / 1000 > RECORDER_WAIT_S;
}

/** "12:03 / 30:00" for a running recording, "starting…" while it is being started, "waiting for the recorder…" if that takes too long. */
export function recordingText(startedAt: string | null, minutes: number | null, nowMs: number, createdAt?: string | null): string {
  if (!startedAt || !minutes) return waitingForRecorder(startedAt, createdAt, nowMs) ? "waiting for the recorder…" : "starting…";
  const p = recordingProgress(startedAt, minutes, nowMs);
  return `${fmtClock(p.elapsed)} / ${fmtClock(p.total)}`;
}

/** The camera card while it is attempting: "Attempt 3 · 0:42", or a hint if no recorder has picked it up. */
export function attemptingText(note: string | null, createdAt: string | null, nowMs: number): { line: string; detail: string; warn: boolean } {
  const secs = createdAt ? attemptingFor(createdAt, nowMs) : 0;
  const clock = fmtClock(secs);
  const a = parseAttempt(note);
  if (a.n === null) {
    const stuck = secs > RECORDER_WAIT_S;
    return { line: stuck ? `waiting for the recorder… ${clock}` : `starting… ${clock}`, detail: stuck ? RECORDER_HINT : "", warn: stuck };
  }
  return { line: `try ${a.n} · ${clock}`, detail: a.note, warn: false };
}
