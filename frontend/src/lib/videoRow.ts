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
