import { LINE_COLORS, MAX_LINE_NAME, MAX_LINES, type VirtualLine } from "../../lib/lines";
import { Button } from "../ui/bits";

/** The list beside the picture: rename, recolour and delete lines. Drawing happens on the picture itself. */
export default function LinesPanel({ lines, selectedId, onSelect, onChange }: {
  lines: VirtualLine[]; selectedId: string | null; onSelect: (id: string | null) => void; onChange: (lines: VirtualLine[]) => void;
}) {
  const patch = (id: string, p: Partial<VirtualLine>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...p } : l)));
  return (
    <div className="lines-panel stack">
      <p className="small muted">
        Drag on the picture to draw a line. Drag an end to resize it, or the middle to move it. {lines.length}/{MAX_LINES} lines.
      </p>
      {lines.length === 0 && <p className="small muted">No lines yet.</p>}
      <ul className="lines-list">
        {lines.map((l) => (
          <li key={l.id} className={l.id === selectedId ? "sel" : ""} onClick={() => onSelect(l.id)}>
            <input type="text" value={l.name} maxLength={MAX_LINE_NAME} aria-label="Line name" placeholder="Name"
              onFocus={() => onSelect(l.id)} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} onChange={(e) => patch(l.id, { name: e.target.value })} />
            <span className="swatches" role="group" aria-label="Line colour">
              {LINE_COLORS.map((c) => (
                <button key={c} type="button" className={`swatch${c === l.color ? " on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`}
                  aria-pressed={c === l.color} onClick={(e) => { e.stopPropagation(); patch(l.id, { color: c }); }} />
              ))}
            </span>
            <Button size="sm" variant="ghost" aria-label={`Delete ${l.name || "line"}`}
              onClick={(e) => { e.stopPropagation(); onChange(lines.filter((x) => x.id !== l.id)); if (l.id === selectedId) onSelect(null); }}>✕</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
