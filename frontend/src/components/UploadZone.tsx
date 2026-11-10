import { useEffect, useRef, useState } from "react";
import { uploadWithProgress } from "../api";
import { Button } from "./ui/bits";
import { useToast } from "./ui/Toast";

const ALLOWED = [".mp4", ".avi", ".mov"];
const MAX_BYTES = 4 * 1024 ** 3; // mirrors the server limit; the server stays the authority

export function checkFile(f: File): string | null {
  const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED.includes(ext)) return `“${f.name}” is not supported. Use MP4, AVI or MOV.`;
  if (f.size === 0) return `“${f.name}” is empty.`;
  if (f.size > MAX_BYTES) return `“${f.name}” is larger than 4 GB.`;
  return null;
}

export default function UploadZone({ projectId, onUploaded }: { projectId: number; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<(() => void) | null>(null);
  const [over, setOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState("");
  const toast = useToast();
  useEffect(() => () => cancel.current?.(), []);

  async function start(f: File | undefined) {
    if (!f || file) return;
    const bad = checkFile(f);
    if (bad) { setError(bad); return; }
    setError(""); setFile(f); setPct(0);
    const up = uploadWithProgress(projectId, f, setPct);
    cancel.current = up.cancel;
    try { await up.promise; toast.success("Upload complete. Preparing the video…"); onUploaded(); }
    catch (e) { const m = (e as Error).message; if (m !== "Upload cancelled") setError(m); }
    finally { cancel.current = null; setFile(null); }
  }

  return (
    <div className={`dropzone ${over ? "over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void start(e.dataTransfer.files[0]); }}>
      <input ref={input} type="file" accept=".mp4,.avi,.mov,video/*" hidden aria-label="Choose a video file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; void start(f); }} />
      {file ? (
        <div className="stack" role="status">
          <span>Uploading <b>{file.name}</b> — {Math.round(pct)}%</span>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
          <div><Button size="sm" onClick={() => cancel.current?.()}>Cancel upload</Button></div>
        </div>
      ) : (
        <div className="stack" style={{ alignItems: "center" }}>
          <span>Drag a video here (MP4, AVI, MOV — up to 4 GB) or</span>
          <Button variant="primary" onClick={() => input.current?.click()}>Choose file</Button>
        </div>
      )}
      {error && <p className="alert" role="alert" style={{ marginTop: 12 }}>{error}</p>}
    </div>
  );
}
