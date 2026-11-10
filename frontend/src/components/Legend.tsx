import { memo, useState } from "react";
import { ACTIONS, type Bindings } from "../keys/registry";
import { Keycap } from "./ui/bits";

const LEFT = ["male_in", "male_out"], RIGHT = ["female_in", "female_out"], EITHER = ["in_unknown", "out_unknown"];
const COUNT = new Set([...LEFT, ...RIGHT, ...EITHER]);
const KEY = "sv_legend_open";
// Compact wording for the legend only; Settings keeps the full registry labels.
const SHORT: Record<string, string> = {
  in_unknown: "IN (any)", out_unknown: "OUT (any)", play_pause: "Play/pause", undo: "Undo", jump_back: "Back 3 s",
  speed_1: "Speed 1x", speed_2: "Speed 2x", speed_3: "Speed 3x", speed_4: "Speed 4x", step_back: "Frame back", step_forward: "Frame fwd",
};

function read(): boolean { try { return localStorage.getItem(KEY) !== "0"; } catch { return true; } }

/** Reads the user's current bindings from the single registry (ACTIONS + bindings). */
function Legend({ bindings }: { bindings: Bindings }) {
  const [open, setOpen] = useState(read);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(KEY, o ? "0" : "1"); } catch { /* ignore */ } return !o; });
  const group = (names: string[]) => ACTIONS.filter((a) => names.includes(a.name));
  const player = ACTIONS.filter((a) => !COUNT.has(a.name));
  const Item = ({ a }: { a: (typeof ACTIONS)[number] }) => <li><Keycap code={bindings[a.name]} /> <span>{SHORT[a.name] ?? a.label}</span></li>;
  return (
    <section className="legend card">
      <button className="legend-h" aria-expanded={open} onClick={toggle}><h3>Keys</h3><span aria-hidden>{open ? "▾" : "▸"}</span></button>
      {open && (
        <>
          <div className="lg male"><b>Left hand · ♂ Male</b><ul>{group(LEFT).map((a) => <Item key={a.name} a={a} />)}</ul></div>
          <div className="lg female"><b>Right hand · ♀ Female</b><ul>{group(RIGHT).map((a) => <Item key={a.name} a={a} />)}</ul></div>
          <div className="lg"><b>Gender unknown</b><ul>{group(EITHER).map((a) => <Item key={a.name} a={a} />)}</ul></div>
          <div className="lg"><b>Player</b><ul>{player.map((a) => <Item key={a.name} a={a} />)}</ul></div>
        </>
      )}
    </section>
  );
}
export default memo(Legend);
