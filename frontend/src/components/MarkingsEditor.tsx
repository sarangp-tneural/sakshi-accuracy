import { useCallback, useEffect, useState } from "react";
import { api, type MarkingType } from "../api";
import { useSettings } from "../SettingsContext";
import { capture } from "../keys/capture";
import { isBindable } from "../keys/registry";
import { activeTypes, directionIcon, keyOwner } from "../lib/markings";
import { Button, Keycap } from "./ui/bits";
import { ConfirmDialog } from "./ui/Modal";
import { useToast } from "./ui/Toast";

type Dir = "in" | "out" | "";
const DIR_LABEL: Record<Dir, string> = { in: "IN", out: "OUT", "": "No direction" };
const toDir = (d: MarkingType["direction"]): Dir => d ?? "";
const fromDir = (d: Dir) => (d === "" ? null : d);
const PALETTE = ["#3b82f6", "#ec4899", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6", "#ef4444", "#64748b"];

function setCapture(on: boolean) { capture.active = on; window.dispatchEvent(new Event("sv-capture")); }

/** The project's markings: what you can count, each with a label, a shortcut key and an optional IN/OUT direction. */
export default function MarkingsEditor({ projectId, onChange }: { projectId: number; onChange?: (types: MarkingType[]) => void }) {
  const { settings } = useSettings();
  const toast = useToast();
  const [types, setTypes] = useState<MarkingType[] | null>(null);
  const [err, setErr] = useState("");
  const [capturing, setCapturing] = useState<number | "new" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<MarkingType | null>(null);
  const [draft, setDraft] = useState<{ label: string; direction: Dir; key_code: string; color: string }>({ label: "", direction: "", key_code: "", color: PALETTE[2] });

  const apply = useCallback((next: MarkingType[]) => { setTypes(next); onChange?.(next); }, [onChange]);
  const load = useCallback(() => { api.markingTypes(projectId).then(apply).catch((e) => setErr(e.message)); }, [projectId, apply]);
  useEffect(load, [load]);
  useEffect(() => { setCapture(capturing !== null); return () => setCapture(false); }, [capturing]);

  const current = types ? activeTypes(types) : [];
  const player = settings.key_bindings;

  // key capture: one listener, for a row or for the "new marking" form
  useEffect(() => {
    if (capturing === null) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.repeat) return;
      if (e.code === "Escape") { setCapturing(null); return; }
      if (!isBindable(e.code)) { setNote("That key can't be used (modifiers, Tab, Esc and Enter are reserved). Press another key, or Esc to cancel."); return; }
      const owner = keyOwner(e.code, types ?? [], player, capturing === "new" ? undefined : capturing);
      if (owner) { setNote(`${e.code.replace(/^Key/, "")} is already used by "${owner}". Press another key.`); return; }
      setNote(null);
      if (capturing === "new") setDraft((d) => ({ ...d, key_code: e.code }));
      else void patch(capturing, { key_code: e.code });
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const patch = (id: number, p: Partial<Pick<MarkingType, "label" | "direction" | "key_code" | "color">>) =>
    api.patchMarkingType(id, p).then((t) => apply((types ?? []).map((x) => (x.id === id ? t : x)))).catch(toast.error);

  const add = async () => {
    try {
      const t = await api.createMarkingType(projectId, { label: draft.label.trim(), direction: fromDir(draft.direction), key_code: draft.key_code, color: draft.color });
      apply([...(types ?? []), t]);
      setDraft((d) => ({ ...d, label: "", key_code: "", color: PALETTE[(current.length + 3) % PALETTE.length] }));
      toast.success(`Added "${t.label}"`);
    } catch (e) { toast.error(e); }
  };

  const move = async (i: number, d: -1 | 1) => {
    const ids = current.map((t) => t.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    try { apply(await api.reorderMarkingTypes(projectId, ids)); } catch (e) { toast.error(e); }
  };

  const remove = async (t: MarkingType) => {
    setRemoving(null);
    try { await api.deleteMarkingType(t.id); load(); toast.success(`Removed "${t.label}"`); } catch (e) { toast.error(e); }
  };

  if (err) return <p className="alert" role="alert">{err}</p>;
  if (!types) return <p className="muted small">Loading markings…</p>;
  const canAdd = draft.label.trim() !== "" && draft.key_code !== "";

  return (
    <section className="stack" aria-label="Markings">
      <div className="row"><h3>Markings</h3></div>
      <p className="small muted" style={{ margin: "4px 0" }}>
        What you can count in this project, each with its own key. IN and OUT markings add to the IN/OUT totals; a marking with no direction (for example “Greeting”) is counted on its own. These also form the fields of the Sakshi result.
      </p>
      <div role="list">
        {current.map((t, i) => (
          <div key={t.id} role="listitem" className={`keyrow mk-row ${capturing === t.id ? "capturing" : ""}`}>
            <span className="row" style={{ gap: 6 }}>
              <input type="color" aria-label={`Colour of ${t.label}`} value={t.color ?? "#64748b"} style={{ width: 28, padding: 0 }}
                onChange={(e) => void patch(t.id, { color: e.target.value })} />
              <input aria-label="Marking name" defaultValue={t.label} maxLength={60} key={t.label} style={{ minWidth: 0, flex: 1 }}
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.label) void patch(t.id, { label: v }); else e.target.value = t.label; }}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            </span>
            <select aria-label={`Direction of ${t.label}`} value={toDir(t.direction)} onChange={(e) => void patch(t.id, { direction: fromDir(e.target.value as Dir) })}>
              {(["in", "out", ""] as Dir[]).map((d) => <option key={d} value={d}>{d ? directionIcon(d) + " " : ""}{DIR_LABEL[d]}</option>)}
            </select>
            {capturing === t.id ? <span className="small" role="status">Press a key… <span className="muted">(Esc cancels)</span></span> : <Keycap code={t.key_code} />}
            <span className="row">
              {capturing === t.id
                ? <Button size="sm" onClick={() => setCapturing(null)}>Cancel</Button>
                : <Button size="sm" onClick={() => { setNote(null); setCapturing(t.id); }} aria-label={`Change key for ${t.label}`}>Change</Button>}
              <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => void move(i, -1)} aria-label={`Move ${t.label} up`}>↑</Button>
              <Button size="sm" variant="ghost" disabled={i === current.length - 1} onClick={() => void move(i, 1)} aria-label={`Move ${t.label} down`}>↓</Button>
              <Button size="sm" variant="ghost" onClick={() => setRemoving(t)} aria-label={`Remove ${t.label}`}>✕</Button>
            </span>
            {capturing === t.id && note && <div className="conflict" role="alert">{note}</div>}
          </div>
        ))}
        {!current.length && <p className="muted small">No markings yet. Add one below.</p>}
      </div>

      <div className="keyrow mk-row mk-new" role="group" aria-label="Add a marking">
        <span className="row" style={{ gap: 6 }}>
          <input type="color" aria-label="Colour of the new marking" value={draft.color} style={{ width: 28, padding: 0 }} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          <input aria-label="New marking name" placeholder="New marking, e.g. Greeting" value={draft.label} maxLength={60} style={{ minWidth: 0, flex: 1 }}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && canAdd) void add(); }} />
        </span>
        <select aria-label="Direction of the new marking" value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as Dir })}>
          {(["in", "out", ""] as Dir[]).map((d) => <option key={d} value={d}>{d ? directionIcon(d) + " " : ""}{DIR_LABEL[d]}</option>)}
        </select>
        {capturing === "new" ? <span className="small" role="status">Press a key… <span className="muted">(Esc cancels)</span></span>
          : draft.key_code ? <Keycap code={draft.key_code} /> : <span className="small muted">no key</span>}
        <span className="row">
          {capturing === "new"
            ? <Button size="sm" onClick={() => setCapturing(null)}>Cancel</Button>
            : <Button size="sm" onClick={() => { setNote(null); setCapturing("new"); }}>Set key</Button>}
          <Button size="sm" variant="primary" disabled={!canAdd} onClick={() => void add()}>Add</Button>
        </span>
        {capturing === "new" && note && <div className="conflict" role="alert">{note}</div>}
      </div>

      {removing && (
        <ConfirmDialog title={`Remove “${removing.label}”?`} danger confirmLabel="Remove"
          message={removing.mark_count
            ? `${removing.mark_count} existing mark${removing.mark_count === 1 ? "" : "s"} keep this name, but you can no longer count it, and its key is freed.`
            : "Its key is freed. Nothing has been counted with it."}
          onCancel={() => setRemoving(null)} onConfirm={() => void remove(removing)} />
      )}
    </section>
  );
}
