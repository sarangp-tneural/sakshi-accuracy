import { useEffect, useRef, useState } from "react";
import { useSettings } from "../SettingsContext";
import type { MarkingType } from "../api";
import MarkingsEditor from "./MarkingsEditor";
import { ACTIONS, keyLabel, labelOf, rebind, swap } from "../keys/registry";
import { capture } from "../keys/capture";
import { Button, Keycap } from "./ui/bits";
import { ConfirmDialog } from "./ui/Modal";
import { useToast } from "./ui/Toast";

function setCapture(on: boolean) { capture.active = on; window.dispatchEvent(new Event("sv-capture")); }

/** Used both in the Project > Settings tab and in the Count-screen drawer. */
export default function SettingsPanel({ projectId, onMarkingsChange }: { projectId?: number; onMarkingsChange?: (t: MarkingType[]) => void }) {
  const { settings, update, reset } = useSettings();
  const toast = useToast();
  const [capturing, setCapturing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ action: string; code: string; with: string } | null>(null);
  const [note, setNote] = useState<{ action: string; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [delay, setDelay] = useState(settings.reaction_delay_s);
  const delayTimer = useRef<number | undefined>(undefined);
  const b = settings.key_bindings;

  useEffect(() => { setDelay(settings.reaction_delay_s); }, [settings.reaction_delay_s]);
  useEffect(() => { setCapture(capturing !== null); return () => setCapture(false); }, [capturing]);
  useEffect(() => () => clearTimeout(delayTimer.current), []);

  const save = (patch: Parameters<typeof update>[0], ok = "Saved") => update(patch).then(() => toast.success(ok)).catch(toast.error);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      if (e.code === "Escape") { setCapturing(null); return; }
      const r = rebind(b, capturing, e.code);
      if (r.ok) { void save({ key_bindings: r.bindings }); setCapturing(null); }
      else if (r.reason === "conflict") { setConflict({ action: capturing, code: e.code, with: r.with }); setCapturing(null); }
      else setNote({ action: capturing, text: "That key can't be used (modifiers, Tab, Esc and Enter are reserved). Press another key, or Esc to cancel." });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const onDelay = (v: number) => {
    if (!(v >= 0 && v <= 3)) return;
    setDelay(v);
    clearTimeout(delayTimer.current);
    delayTimer.current = window.setTimeout(() => void save({ reaction_delay_s: v }), 450);
  };

  return (
    <div className="stack">
      {projectId !== undefined && <MarkingsEditor projectId={projectId} onChange={onMarkingsChange} />}
      <section className="stack">
        <h3>Counting</h3>
        <div className="field">
          <label htmlFor="delay">Reaction delay</label>
          <div className="row">
            <input id="delay-range" aria-label="Reaction delay slider" type="range" min={0} max={3} step={0.05} value={delay} onChange={(e) => onDelay(Number(e.target.value))} style={{ flex: 1, minWidth: 120 }} />
            <input id="delay" type="number" min={0} max={3} step={0.05} value={delay} onChange={(e) => onDelay(Number(e.target.value))} style={{ width: 80 }} /> <span>s</span>
          </div>
          <span className="hint">Marks are placed this many seconds (× playback speed) before the key press.</span>
        </div>
        <label className="switch"><input type="checkbox" checked={settings.sound_enabled} onChange={(e) => void save({ sound_enabled: e.target.checked })} /> Click sound on each mark</label>
        <label className="switch"><input type="checkbox" checked={settings.slow_after_jump} onChange={(e) => void save({ slow_after_jump: e.target.checked })} /> Slow to 1x for 5 s after jumping back</label>
      </section>

      <section>
        <div className="row"><h3>Player shortcuts</h3><span className="spacer" /><Button size="sm" onClick={() => setConfirmAll(true)}>Reset all</Button></div>
        <p className="small muted" style={{ margin: "4px 0" }}>Click Change, then press the new key. Esc cancels. Single keys only. Counting keys are set per marking, above.</p>
        <div role="list">
          {ACTIONS.map((a) => {
            const isCap = capturing === a.name;
            const c = conflict?.action === a.name ? conflict : null;
            return (
              <div key={a.name} role="listitem" className={`keyrow ${isCap ? "capturing" : ""}`}>
                <span>{a.label}</span>
                {isCap ? <span className="small" role="status">Press a key… <span className="muted">(Esc cancels)</span></span> : <Keycap code={b[a.name]} />}
                <span className="row">
                  {isCap
                    ? <Button size="sm" onClick={() => setCapturing(null)}>Cancel</Button>
                    : <Button size="sm" onClick={() => { setNote(null); setConflict(null); setCapturing(a.name); }} aria-label={`Change key for ${a.label}`}>Change</Button>}
                  <Button size="sm" variant="ghost" disabled={b[a.name] === a.default} onClick={() => void reset(a.name).then(() => toast.success(`${a.label} reset`)).catch(toast.error)} aria-label={`Reset ${a.label} to default`}>Reset</Button>
                </span>
                {c && (
                  <div className="conflict" role="alert">
                    <span><Keycap code={c.code} /> is already used by <b>{labelOf(c.with)}</b>.</span>
                    <Button size="sm" variant="primary" onClick={() => { void save({ key_bindings: swap(b, c.action, c.code) }, "Keys swapped"); setConflict(null); }}>
                      Swap (gives {labelOf(c.with)} {keyLabel(b[c.action])})
                    </Button>
                    <Button size="sm" onClick={() => setConflict(null)}>Cancel</Button>
                  </div>
                )}
                {note?.action === a.name && <div className="conflict" role="alert">{note.text}</div>}
              </div>
            );
          })}
        </div>
      </section>
      {confirmAll && (
        <ConfirmDialog title="Reset all shortcuts?" message="Every shortcut goes back to its default key." confirmLabel="Reset all" danger
          onCancel={() => setConfirmAll(false)}
          onConfirm={() => { setConfirmAll(false); void reset().then(() => toast.success("Shortcuts reset")).catch(toast.error); }} />
      )}
    </div>
  );
}
