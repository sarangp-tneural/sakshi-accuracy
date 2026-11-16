import { memo, useState } from "react";
import type { MarkingType } from "../api";
import { ACTIONS, type Bindings } from "../keys/registry";
import { activeTypes, directionIcon, typeColor } from "../lib/markings";
import { Keycap } from "./ui/bits";

const KEY = "sv_legend_open";
// Compact wording for the legend only; Settings keeps the full registry labels.
const SHORT: Record<string, string> = {
  play_pause: "Play/pause", undo: "Undo", jump_back: "Back 3 s",
  speed_1: "Speed 1x", speed_2: "Speed 2x", speed_3: "Speed 3x", speed_4: "Speed 4x", step_back: "Step back", step_forward: "Step fwd",
};

function read(): boolean { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } }

/** Counting keys come from the project's markings, player keys from the user's bindings. */
function Legend({ bindings, types }: { bindings: Bindings; types: MarkingType[] }) {
  const [open, setOpen] = useState(read);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(KEY, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const marks = activeTypes(types);
  return (
    <section className="legend card">
      <button className="legend-h" aria-expanded={open} onClick={toggle}><h3>Keys</h3><span aria-hidden>{open ? "▾" : "▸"}</span></button>
      {open && (
        <>
          <div className="lg"><b>Markings</b>
            <ul>{marks.map((t) => (
              <li key={t.id}><Keycap code={t.key_code} /> <span style={{ color: typeColor(t) }}><span aria-hidden>{directionIcon(t.direction)}</span> {t.label}</span></li>
            ))}</ul>
            {!marks.length && <p className="small muted">No markings. Add some in Settings.</p>}
          </div>
          <div className="lg"><b>Player</b><ul>{ACTIONS.map((a) => <li key={a.name}><Keycap code={bindings[a.name]} /> <span>{SHORT[a.name] ?? a.label}</span></li>)}</ul></div>
        </>
      )}
    </section>
  );
}
export default memo(Legend);
