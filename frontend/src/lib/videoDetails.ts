import type { Video } from "../api";
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
  const planned = (v.rtsp_minutes ?? 0) * 60;

  if (isRtsp) {
    if (v.camera_name) out.push({ label: "Camera", value: v.camera_name });
    if (v.rtsp_url_masked) out.push({ label: "Stream", value: v.rtsp_url_masked, wide: true, mono: true });
    out.push({ label: "Requested", value: fmtDateTime(v.created_at) });
    const startedMs = v.started_at ? new Date(v.started_at).getTime() : null;
    out.push({ label: "Recording started", value: v.started_at ? fmtDateTime(v.started_at) : recording ? "starting…" : "not recorded" });
    if (recording) {
      const elapsed = startedMs ? Math.min(planned, Math.max(0, (now - startedMs) / 1000)) : 0;
      out.push({ label: "Planned end", value: startedMs ? fmtDateTime(new Date(startedMs + planned * 1000).toISOString()) : "—" });
      out.push({ label: "Recorded so far", value: `${fmtClock(elapsed)} of ${fmtClock(planned)}` });
    } else {
      out.push({ label: "Recording ended", value: v.ended_at ? fmtDateTime(v.ended_at) : "not recorded" });
      const ran = v.started_at && v.ended_at ? (new Date(v.ended_at).getTime() - new Date(v.started_at).getTime()) / 1000 : null;
      // a failed recording produced no usable video, so "recorded" would be misleading: only say how long the attempt ran
      const rec = v.status === "failed" ? null : (v.duration_s ?? ran);
      if (v.status === "failed") {
        if (ran !== null) out.push({ label: "Attempt ran for", value: fmtClock(ran) });
      } else if (rec !== null && planned) {
        const short = rec < planned - GRACE_S;
        out.push({ label: "Recorded", value: `${fmtClock(rec)} of ${fmtClock(planned)} planned${short ? " (ended early)" : ""}`, tone: short ? "warn" : undefined });
      } else if (planned) {
        out.push({ label: "Planned length", value: `${v.rtsp_minutes} min` });
      }
    }
  } else {
    out.push({ label: "Uploaded", value: fmtDateTime(v.created_at) });
    if (v.duration_s) out.push({ label: "Duration", value: fmtTime(v.duration_s), mono: true });
  }

  out.push({ label: "Video", value: fmtStream(v.width, v.height, v.fps, v.vcodec) });
  out.push({ label: "File size", value: fmtBytes(v.file_size) });

  const total = v.mark_total;
  out.push({ label: "Marks", value: total ? `${total} · ▲ IN ${v.mark_in} · ▼ OUT ${v.mark_out}` : "none yet", tone: total ? undefined : "muted" });
  if (total) out.push({ label: "Gender", value: `♂ ${v.mark_male} · ♀ ${v.mark_female} · ? ${v.mark_unknown}` });
  out.push({ label: "Sakshi result", value: v.sakshi_entered ? "entered" : "not entered", tone: v.sakshi_entered ? "good" : "muted" });

  if (v.status_reason) out.push({ label: v.status === "failed" ? "Why it failed" : v.status === "partial" ? "Why it is partial" : "Note", value: v.status_reason, wide: true,
    tone: v.status === "failed" ? "bad" : v.status === "partial" ? "warn" : undefined });
  return out;
}
