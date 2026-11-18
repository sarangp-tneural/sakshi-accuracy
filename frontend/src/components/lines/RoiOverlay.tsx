import { useRef, useState } from "react";
import type { Roi } from "../../api";
import { clientToNorm } from "../../lib/lines";
import { hitRoi, moveRect, rectFromDrag, resizeRect, type RoiPart } from "../../lib/roi";
import type { BoxPx } from "./LinesOverlay";

interface Props {
  roi: Roi | null;
  box: BoxPx; // where the picture is, in pixels of the offset parent
  onChange: (roi: Roi) => void; // once per finished drag
}

type Drag = { part: RoiPart | "new"; sx: number; sy: number; orig: Roi | null };

/** The focus area: drag on the picture to draw it, drag inside to move it, drag a corner to resize it. Coordinates are 0..1. */
export default function RoiOverlay({ roi, box, onChange }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<Roi | null>(null);
  const drag = useRef<Drag | null>(null);
  const shown = draft ?? roi;

  const norm = (e: React.PointerEvent) => clientToNorm(e.clientX, e.clientY, svg.current!.getBoundingClientRect());

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = norm(e);
    const part = roi ? hitRoi(roi, p.x, p.y, 12 / Math.max(1, box.w), 12 / Math.max(1, box.h)) : null;
    drag.current = { part: part ?? "new", sx: p.x, sy: p.y, orig: roi };
    svg.current!.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = norm(e);
    if (d.part === "new") setDraft(rectFromDrag(d.sx, d.sy, p.x, p.y));
    else if (d.part === "body") setDraft(moveRect(d.orig!, p.x - d.sx, p.y - d.sy));
    else setDraft(resizeRect(d.orig!, d.part, p.x, p.y));
  };
  const up = () => {
    const d = drag.current; drag.current = null;
    const final = draft; setDraft(null);
    if (!d || !final) return; // a click without moving changes nothing
    onChange(final);
  };

  const x = shown ? shown.x * box.w : 0, y = shown ? shown.y * box.h : 0, w = shown ? shown.w * box.w : 0, h = shown ? shown.h * box.h : 0;
  return (
    <svg ref={svg} className="lines-overlay editing" data-ui style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      viewBox={`0 0 ${Math.max(1, box.w)} ${Math.max(1, box.h)}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      aria-label="Focus area">
      {shown && (
        <g>
          <path fillRule="evenodd" fill="rgba(0,0,0,.45)" d={`M0 0H${box.w}V${box.h}H0Z M${x} ${y}h${w}v${h}h${-w}Z`} />
          <rect x={x} y={y} width={w} height={h} fill="none" stroke="#4dd2ff" strokeWidth={2} strokeDasharray="6 4" />
          {[[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={6} fill="#4dd2ff" stroke="#000" strokeWidth={1.5} />)}
        </g>
      )}
    </svg>
  );
}
