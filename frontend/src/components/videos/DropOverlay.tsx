import { useEffect, useState } from "react";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/** Drop a file anywhere on the page to upload it. Shows a full-page overlay while a file is dragged over. */
export default function DropOverlay({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; depth++; setOver(true); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (depth === 0) setOver(false); };
    const overEv = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) onFiles(files);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { depth = 0; setOver(false); } };
    window.addEventListener("dragenter", enter); window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overEv); window.addEventListener("drop", drop); window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("dragenter", enter); window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overEv); window.removeEventListener("drop", drop); window.removeEventListener("keydown", esc);
    };
  }, [onFiles]);
  if (!over) return null;
  return (
    <div className="dropveil" role="status" aria-live="polite">
      <div className="dropbox"><b>Drop to upload</b><span>MP4, AVI or MOV, up to 4 GB each</span></div>
    </div>
  );
}
