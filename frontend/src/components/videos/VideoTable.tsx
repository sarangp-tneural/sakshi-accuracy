import { useState } from "react";
import type { Video } from "../../api";
import type { UploadItem } from "../../hooks/useUploads";
import UploadRows from "./UploadRows";
import VideoRow, { COLS } from "./VideoRow";

interface Props {
  items: Video[];
  uploads: UploadItem[];
  now: number;
  dim?: boolean; // results are being refreshed
  onCancelUpload: (id: number) => void;
  onOpen: (v: Video) => void;
  onStop: (v: Video) => void;
  onExport: (v: Video) => void;
  onDelete: (v: Video) => void;
  onRemoveFile: (v: Video) => void;
}

export default function VideoTable({ items, uploads, now, dim, onCancelUpload, onOpen, onStop, onExport, onDelete, onRemoveFile }: Props) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className={`tablewrap ${dim ? "dim" : ""}`}>
      <table className="table vtable">
        <caption className="sr-only">Videos in this project</caption>
        <thead>
          <tr>
            <th scope="col">Name</th><th scope="col">Source</th><th scope="col">Status</th><th scope="col">Duration</th>
            <th scope="col">Marks</th><th scope="col">Sakshi</th><th scope="col" className="c-added">Added</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <UploadRows items={uploads} cols={COLS} onCancel={onCancelUpload} />
          {items.map((v) => (
            <VideoRow key={v.id} v={v} now={now} expanded={open.has(v.id)} onToggle={toggle} onOpen={onOpen} onStop={onStop} onExport={onExport} onDelete={onDelete} onRemoveFile={onRemoveFile} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
