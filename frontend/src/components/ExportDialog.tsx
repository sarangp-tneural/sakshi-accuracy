import { useEffect, useState } from "react";
import { api, downloadExport } from "../api";
import { Modal } from "./ui/Modal";
import { Button, Spinner } from "./ui/bits";
import { useToast } from "./ui/Toast";

export default function ExportDialog({ videoId, videoName, onClose }: { videoId: number; videoName: string; onClose: () => void }) {
  const [kind, setKind] = useState<"csv" | "xlsx">("xlsx");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { api.marks(videoId).then((m) => setCount(m.length)).catch(() => setCount(null)); }, [videoId]);

  async function go() {
    setBusy(true);
    try { await downloadExport(videoId, kind); toast.success("Export downloaded"); onClose(); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  return (
    <Modal title="Export" onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>{videoName}</p>
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 8 }}>
        <legend>Format</legend>
        <label className="switch"><input type="radio" name="fmt" checked={kind === "xlsx"} onChange={() => setKind("xlsx")} /> Excel (.xlsx), two sheets: Comparison and Marks</label>
        <label className="switch"><input type="radio" name="fmt" checked={kind === "csv"} onChange={() => setKind("csv")} /> CSV (.csv), comparison then marks in one file</label>
      </fieldset>
      <div>
        <b>Included</b>
        <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
          <li>Comparison: IN, OUT, total, male, female (manual, Sakshi, difference, %)</li>
          <li>Marks: {count === null ? "…" : count} rows (time, marking, direction, created at)</li>
        </ul>
      </div>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy} onClick={go}>{busy ? <><Spinner label="Exporting" /> Preparing…</> : "Download"}</Button>
      </div>
    </Modal>
  );
}
