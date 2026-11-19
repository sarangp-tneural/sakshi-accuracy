import type { Video } from "../api";

/** What deleting this video removes, in words, for the confirmation dialog. */
export function deleteWarning(v: Pick<Video, "name" | "mark_total" | "sakshi_entered">): string {
  const parts: string[] = [];
  if (v.mark_total > 0) parts.push(`its ${v.mark_total} mark${v.mark_total === 1 ? "" : "s"}`);
  if (v.sakshi_entered) parts.push("its Sakshi result");
  const also = parts.length === 0 ? "" : parts.length === 1 ? ` and ${parts[0]}` : ` and ${parts.join(" and ")}`;
  return `“${v.name}”${also} will be permanently deleted.${parts.length ? " This cannot be undone." : " The video file is removed from the server."}`;
}

/** Can the Count screen open this video? */
export const isOpenable = (v: Pick<Video, "status">) => v.status === "ready" || v.status === "partial";
/** Can it be exported? Same rule: there must be something counted on a playable video. */
export const isExportable = isOpenable;

/** Still being recorded, or still trying to reach the camera. */
export const isActive = (v: Pick<Video, "status">) => v.status === "connecting" || v.status === "recording";

/** What "processing" really is right now: waiting for its turn, or compressing. Older videos have no times, so just "processing". */
export type ProcessingPhase = "waiting" | "compressing" | "processing";
export function processingPhase(v: Pick<Video, "status" | "queued_at" | "converting_at" | "converted_at">): ProcessingPhase | null {
  if (v.status !== "processing") return null;
  if (v.converting_at && !v.converted_at) return "compressing";
  if (v.queued_at && !v.converting_at) return "waiting";
  return "processing";
}

/** Seconds from one ISO time to another (or to `nowMs`); null if either is missing. */
export function secondsBetween(fromIso: string | null | undefined, toIso: string | null | undefined, nowMs: number): number | null {
  if (!fromIso) return null;
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : nowMs;
  return Number.isNaN(from) || Number.isNaN(to) ? null : Math.max(0, (to - from) / 1000);
}

/** "Attempt 3 · The camera refused the connection." becomes { n: 3, note: "The camera refused the connection." }. */
export function parseAttempt(reason: string | null | undefined): { n: number | null; note: string } {
  const m = /^Attempt (\d+)(?:\s·\s(.*))?$/s.exec((reason ?? "").trim());
  return m ? { n: Number(m[1]), note: m[2] ?? "" } : { n: null, note: (reason ?? "").trim() };
}

/** Seconds spent attempting so far (from the moment recording was requested). */
export function attemptingFor(createdAtIso: string, nowMs: number): number {
  const t = new Date(createdAtIso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, (nowMs - t) / 1000);
}

/** The stop button reads Cancel while it is only attempting to connect. */
export const stopLabel = (v: Pick<Video, "status">) => (v.status === "connecting" ? "Cancel" : "■ Stop");

/** Wording of the confirmation before Stop / Cancel. */
export function stopDialog(attempting: boolean): { title: string; message: string; confirm: string } {
  return attempting
    ? { title: "Cancel the attempt?", message: "It stops trying to reach the camera. Nothing will be recorded.", confirm: "Cancel the attempt" }
    : { title: "Stop recording?", message: "Recording stops now and the part recorded so far is saved as a video you can count.", confirm: "Stop and keep video" };
}

/** What to tell the user right after Stop, from the video the server returns. */
export function stopMessage(v: Pick<Video, "status" | "status_reason">): string {
  if (v.status === "connecting") return "Cancelling the attempt…";
  if (v.status === "recording") return "Stopping… saving the video";
  if (v.status === "processing") return "Stopped. Saving the part that was recorded…";
  if (v.status === "failed") return v.status_reason ?? "The recording had already stopped. Nothing was recorded.";
  return "Stopped";
}

/** Only the video FILE was deleted; counts, marks and results are still there. */
export const isFileRemoved = (v: Pick<Video, "video_removed_at">) => !!v.video_removed_at;

/** Can "Delete video file" be offered? Finished videos whose file still exists. */
export const canRemoveFile = (v: Pick<Video, "status" | "video_removed_at">) =>
  !isFileRemoved(v) && (v.status === "ready" || v.status === "partial" || v.status === "failed");

/** Confirmation text for deleting only the video file. */
export function removeFileWarning(v: Pick<Video, "name" | "mark_total" | "sakshi_entered" | "disk_bytes" | "file_size">, fmt: (n: number | null) => string): string {
  const size = v.disk_bytes ?? v.file_size;
  const frees = size ? `This frees about ${fmt(size)}. ` : "";
  const keep = [v.mark_total > 0 ? `its ${v.mark_total} mark${v.mark_total === 1 ? "" : "s"}` : "", v.sakshi_entered ? "the Sakshi result" : "", "all its details"].filter(Boolean);
  const list = keep.length > 1 ? `${keep.slice(0, -1).join(", ")} and ${keep[keep.length - 1]}` : keep[0];
  return `Delete the video file of “${v.name}”? ${frees}${list[0].toUpperCase()}${list.slice(1)} stay. The video can no longer be watched and new marks cannot be added. This cannot be undone.`;
}
