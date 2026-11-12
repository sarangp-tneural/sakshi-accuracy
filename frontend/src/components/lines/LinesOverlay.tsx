import { useRef, useState } from "react";
import { clientToNorm, dragLine, hitTest, MIN_LINE_LEN, lineLength, MAX_LINES, newLine, type Part, type VirtualLine } from "../../lib/lines";

export interface BoxPx { x: number; y: number; w: number; h: number }

interface Props {
  lines: VirtualLine[];
  /** where the picture is, in pixels of the offset parent (the overlay is placed exactly there) */
  box: BoxPx;
  editing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** called once per finished edit (pointer up), not on every pixel of a drag */
  onChange: (lines: VirtualLine[]) => void;
}

type Drag = { id: string; part: Part; startX: number; startY: number; orig: VirtualLine; isNew: boolean };

/** Draws the lines over the picture; when `editing`, draw new ones by dragging, move endpoints or whole lines. Coordinates are 0..1. */
export default function LinesOverlay({ lines, box, editing, selectedId, onSelect, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<VirtualLine[] | null>(null); // lines while a drag is in progress
  const drag = useRef<Drag | null>(null);
  const shown = draft ?? lines;

  const norm = (e: React.PointerEvent) => clientToNorm(e.clientX, e.clientY, svg.current!.getBoundingClientRect());

  const down = (e: React.PointerEvent) => {
    if (!editing || e.button !== 0) return;
    e.stopPropagation();
    const p = norm(e);
    const hit = hitTest(lines, p.x, p.y, { w: box.w, h: box.h });
    if (hit) {
      const orig = lines.find((l) => l.id === hit.id)!;
      drag.current = { id: hit.id, part: hit.part, startX: p.x, startY: p.y, orig, isNew: false };
      onSelect(hit.id);
    } else if (lines.length < MAX_LINES) {
      const l = newLine(lines, p.x, p.y);
      drag.current = { id: l.id, part: "p2", startX: p.x, startY: p.y, orig: l, isNew: true };
      setDraft([...lines, l]);
      onSelect(l.id);
    } else { onSelect(null); return; }
    svg.current!.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = norm(e);
    const next = dragLine(d.orig, d.part, p.x, p.y, p.x - d.startX, p.y - d.startY);
    setDraft(d.isNew ? [...lines, next] : lines.map((l) => (l.id === d.id ? next : l)));
  };

  const up = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const final = draft;
    setDraft(null);
    if (!final) return;
    const cur = final.find((l) => l.id === d.id);
    if (d.isNew && (!cur || lineLength(cur) < MIN_LINE_LEN)) { onSelect(null); return; } // a stray click, not a line
    if (cur && JSON.stringify(cur) === JSON.stringify(d.orig) && !d.isNew) return; // clicked without moving
    onChange(final);
  };

  return (
    <svg ref={svg} className={`lines-overlay${editing ? " editing" : ""}`} data-ui={editing ? "" : undefined}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      viewBox={`0 0 ${Math.max(1, box.w)} ${Math.max(1, box.h)}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="Virtual lines">
      {shown.map((l) => {
        const x1 = l.x1 * box.w, y1 = l.y1 * box.h, x2 = l.x2 * box.w, y2 = l.y2 * box.h;
        const sel = editing && l.id === selectedId;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        return (
          <g key={l.id}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(0,0,0,.65)" strokeWidth={sel ? 6 : 5} strokeLinecap="round" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={l.color} strokeWidth={sel ? 3.5 : 2.5} strokeLinecap="round" />
            {editing && [[x1, y1], [x2, y2]].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r={sel ? 7 : 5} fill={l.color} stroke="#000" strokeWidth={1.5} />
            ))}
            {l.name && (
              <text x={mx} y={my - 9} textAnchor="middle" className="lines-label" paintOrder="stroke" stroke="rgba(0,0,0,.8)" strokeWidth={3} fill={l.color}>{l.name}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
