export const ALLOWED_EXT = [".mp4", ".avi", ".mov"];
export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3; // mirrors the server limit; the server stays the authority

/** null when the file is acceptable, otherwise the message to show. */
export function checkFile(f: { name: string; size: number }): string | null {
  const dot = f.name.lastIndexOf(".");
  const ext = dot < 0 ? "" : f.name.slice(dot).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return `“${f.name}” is not supported. Use MP4, AVI or MOV.`;
  if (f.size === 0) return `“${f.name}” is empty.`;
  if (f.size > MAX_UPLOAD_BYTES) return `“${f.name}” is larger than 4 GB.`;
  return null;
}
