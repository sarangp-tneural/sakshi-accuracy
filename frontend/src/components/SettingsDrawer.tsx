import { useEffect } from "react";
import { capture } from "../keys/capture";
import { Button } from "./ui/bits";
import SettingsPanel from "./SettingsPanel";

/** Overlay on the right; the <video> element stays mounted so position and playback are untouched. */
export default function SettingsDrawer({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !capture.active) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="drawer" role="dialog" aria-label="Settings" aria-modal="false">
      <div className="row"><h2>Settings</h2><span className="spacer" /><Button size="sm" onClick={onClose}>Close ✕</Button></div>
      <SettingsPanel />
    </aside>
  );
}
