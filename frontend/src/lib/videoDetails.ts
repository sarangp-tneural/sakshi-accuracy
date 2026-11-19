import type { Video } from "../api";
import { waitingForRecorder } from "./cameras";
import { attemptingFor, parseAttempt, processingPhase, secondsBetween } from "./videoRow";
import { fmtBytes, fmtClock, fmtDateTime, fmtStream, fmtTime } from "./format";

export interface Detail {
  label: string;
  value: string;
  wide?: boolean; // spans the whole row
  tone?: "good" | "warn" | "bad" | "muted";
  mono?: boolean;
}

const GRACE_S = 5; // a recording this much shorter than planned counts as "ended early"

/** Everything worth showing about a video row. Pure so it can be tested; `now` is for live recordings. */
export function videoDetails(v: Video, now: number): Detail[] {
  const out: Detail[] = [];
  const isRtsp = v.source === "rtsp";
  const recording = v.status === "recording";
  const attempting = v.status === "connecting";
  const planned = (v.rtsp_minutes ?? 0) * 60;

  if (isRtsp) {
    if (v.camera_name) out.push({ label: "Camera", value: v.camera_name });
    if (v.rtsp_url_masked) out.push({ label: "Stream", value: v.rtsp_url_masked, wide: true, mono: true });
    out.push({ label: "Requested", value: fmtDateTime(v.created_at) });
    const startedMs = v.started_at ? new Date(v.started_at).getTime() : null;
    const createdMs = new Date(v.created_at).getTime();

    if (attempting) {
      const a = parseAttempt(v.status_reason);
      const waiting = a.n === null && waitingForRecorder(null, v.created_at, now);
      out.push({ label: "Recording started", value: "not yet: still attempting to connect", tone: "muted" });
      out.push({ label: "Attempting for", value: fmtClock(attemptingFor(v.created_at, now)) });
      out.push({ label: "Attempt", value: waiting ? "waiting for the recorder…" : a.n === null ? "starting…" : `try ${a.n}`, tone: waiting ? "warn" : undefined });
    } else {
      out.push({ label: "Recording started", value: v.started_at ? fmtDateTime(v.started_at) : recording ? (waitingForRecorder(null, v.created_at, now) ? "waiting for the recorder…" : "starting…")
          : v.status === "failed" ? "never started (the camera did not connect)" : "not recorded", // older videos simply never stored a start time
        tone: !v.started_at && recording && waitingForRecorder(null, v.created_at, now) ? "warn" : !v.started_at && !recording ? "muted" : undefined });
      if (recording) {
        const elapsed = startedMs ? Math.min(planned, Math.max(0, (now - startedMs) / 1000)) : 0;
        out.push({ label: "Planned end", value: startedMs ? fmtDateTime(new Date(startedMs + planned * 1000).toISOString()) : "—" });
        out.push({ label: "Recorded so far", value: `${fmtClock(elapsed)} of ${fmtClock(planned)}` });
      } else {
        out.push({ label: v.started_at || v.status !== "failed" ? "Recording ended" : "Attempts ended", value: v.ended_at ? fmtDateTime(v.ended_at) : "not recorded" });
        const endMs = v.ended_at ? new Date(v.ended_at).getTime() : null;
        const ran = startedMs !== null && endMs !== null ? (endMs - startedMs) / 1000 : null;
        // a failed recording produced no usable video, so "recorded" would be misleading: only say how long the attempt ran
        const rec = v.status === "failed" ? null : (v.duration_s ?? ran);
        if (v.status === "failed") {
          const from = startedMs ?? createdMs;
          if (endMs !== null && !Number.isNaN(from)) out.push({ label: startedMs === null ? "Attempted for" : "Attempt ran for", value: fmtClock((endMs - from) / 1000) });
        } else if (rec !== null && planned) {
          const short = rec < planned - GRACE_S;
          out.push({ label: "Recorded", value: `${fmtClock(rec)} of ${fmtClock(planned)} planned${short ? " (ended early)" : ""}`, tone: short ? "warn" : undefined });
        } else if (planned) {
          out.push({ label: "Planned length", value: `${v.rtsp_minutes} min` });
        }
      }
    }
  } else {
    out.push({ label: "Uploaded", value: fmtDateTime(v.created_at) });
    if (v.duration_s) out.push({ label: "Duration", value: fmtTime(v.duration_s), mono: true });
  }

  // what happened after recording, step by step (older videos did not store these times: nothing is shown)
  if (v.queued_at) {
    const phase = processingPhase(v);
    const took = (a: string | null | undefined, b: string | null | undefined) => { const s = secondsBetween(a, b, now); return s === null ? "—" : fmtClock(s); };
    if (isRtsp && v.started_at) out.push({ label: "Connected after", value: took(v.created_at, v.started_at), mono: true });
    out.push({ label: "Waiting to convert", value: v.converting_at ? took(v.queued_at, v.converting_at) : v.converted_at ? "—" : `${took(v.queued_at, null)} so far`,
      tone: phase === "waiting" ? "warn" : undefined, mono: true });
    if (v.converting_at) out.push({ label: "Compressing", value: v.converted_at ? took(v.converting_at, v.converted_at) : `${took(v.converting_at, null)} so far`,
      tone: phase === "compressing" ? "warn" : undefined, mono: true });
    if (v.converted_at) {
      out.push({ label: "Finished", value: fmtDateTime(v.converted_at) });
      out.push({ label: "Total time", value: took(v.created_at, v.converted_at), mono: true });
    }
  }

  out.push({ label: "Video", value: fmtStream(v.width, v.height, v.fps, v.vcodec) });
  if (v.video_removed_at) {
    out.push({ label: "Video file", value: `deleted on ${fmtDateTime(v.video_removed_at)} to free space`, tone: "warn" });
    out.push({ label: "Original size", value: fmtBytes(v.file_size) });
  } else if (v.playback_size) {
    // two files are kept: the recording as it came in, and the smaller copy the browser plays
    out.push({ label: "Original size", value: fmtBytes(v.file_size) });
    out.push({ label: "Playable copy", value: `${fmtBytes(v.playback_size)} · up to 1280 px wide` });
  } else out.push({ label: "File size", value: fmtBytes(v.file_size) });

  const total = v.mark_total;
  out.push({ label: "Marks", value: total ? `${total} · ▲ IN ${v.mark_in} · ▼ OUT ${v.mark_out}` : "none yet", tone: total ? undefined : "muted" });
  out.push({ label: "Sakshi result", value: v.sakshi_entered ? "entered" : "not entered", tone: v.sakshi_entered ? "good" : "muted" });

  if (attempting) {
    const note = parseAttempt(v.status_reason).note;
    if (note) out.push({ label: "Latest attempt", value: note, wide: true, tone: "warn" });
  } else if (v.status_reason) out.push({ label: v.status === "failed" ? "Why it failed" : v.status === "partial" ? "Why it is partial" : "Note", value: v.status_reason, wide: true,
    tone: v.status === "failed" ? "bad" : v.status === "partial" ? "warn" : undefined });
  return out;
}
