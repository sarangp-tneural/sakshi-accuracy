import { useRef } from "react";
import { Button } from "../ui/bits";
import { Modal } from "../ui/Modal";
import RtspForm from "../RtspForm";

export function UploadDialog({ onFiles, onClose }: { onFiles: (files: File[]) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <Modal title="Upload a video" onClose={onClose}>
      <p style={{ margin: 0 }}>Drag files anywhere on this page, or choose them here. MP4, AVI or MOV, up to 4 GB each.</p>
      <p className="muted small" style={{ margin: 0 }}>Uploads show their progress in the list, so you can keep working.</p>
      <input ref={input} type="file" multiple accept=".mp4,.avi,.mov,video/*" hidden aria-label="Choose video files"
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) onFiles(f); }} />
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => input.current?.click()}>Choose files…</Button>
      </div>
    </Modal>
  );
}

export function RecordDialog({ projectId, onStarted, onClose }: { projectId: number; onStarted: () => void; onClose: () => void }) {
  return (
    <Modal title="Record from camera" onClose={onClose} wide>
      <RtspForm projectId={projectId} onStarted={() => { onStarted(); onClose(); }} />
    </Modal>
  );
}
