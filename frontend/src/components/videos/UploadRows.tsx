import type { UploadItem } from "../../hooks/useUploads";
import { fmtBytes } from "../../lib/format";
import { Button } from "../ui/bits";

/** Upload progress, shown as rows at the top of the table. Nothing blocks the page. */
export default function UploadRows({ items, cols, onCancel }: { items: UploadItem[]; cols: number; onCancel: (id: number) => void }) {
  return (
    <>
      {items.map((u) => (
        <tr key={u.id} className="uprow">
          <td colSpan={cols}>
            <div className="upl">
              <span className="upl-name" title={u.name}>{u.name}</span>
              <span className="small muted num">{fmtBytes(u.size)}</span>
              {u.state === "error" ? (
                <>
                  <span className="upl-err" role="alert">Upload failed: {u.error}</span>
                  <Button size="sm" onClick={() => onCancel(u.id)}>Dismiss</Button>
                </>
              ) : (
                <>
                  <div className="progress upl-bar" role="progressbar" aria-label={`Uploading ${u.name}`} aria-valuenow={Math.round(u.pct)} aria-valuemin={0} aria-valuemax={100}>
                    <div style={{ width: `${u.state === "queued" ? 0 : u.pct}%` }} />
                  </div>
                  <span className="small num upl-pct">{u.state === "queued" ? "waiting…" : `${Math.round(u.pct)}%`}</span>
                  <Button size="sm" onClick={() => onCancel(u.id)}>Cancel</Button>
                </>
              )}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}
