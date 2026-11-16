import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Mark, MarkingType } from "../api";
import { fmtTime } from "../lib/format";
import { newestFirst } from "../lib/ticks";
import { visibleRange } from "../lib/virtual";
import { activeTypes, directionIcon } from "../lib/markings";
import { Button, MarkBadge } from "./ui/bits";

const ROW_H = 38;
type M = Mark & { pending?: boolean };
export interface MarkPatch { time_s?: number; marking_type_id?: number }

interface Props {
  marks: M[];
  types: MarkingType[]; // every marking of the project, removed ones included (old marks keep their label)
  currentId: number | null; // nearest to the playhead
  selectedId: number | null;
  pickingId: number | null;
  onSeek: (m: M) => void; // also selects
  onPatch: (m: M, p: MarkPatch) => void;
  onDelete: (m: M) => void;
  onPlacePoint: (m: M) => void;
  onClearPoint: (m: M) => void;
  onReplay: (m: M) => void;
  onDone: () => void; // hand focus back to the player
  noVideo?: boolean; // the video file was deleted: no jumping, replaying or placing points
}

/** Windowed list: only the visible rows exist in the DOM, so 5,000 marks stay fast. */
function MarksList({ marks, types, currentId, selectedId, pickingId, onSeek, onPatch, onDelete, onPlacePoint, onClearPoint, onReplay, onDone, noVideo = false }: Props) {
  const sorted = useMemo(() => newestFirst(marks), [marks]);
  const box = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [h, setH] = useState(300);
  const [editing, setEditing] = useState<number | null>(null);
  const raf = useRef(0);
  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    setH(el.clientHeight);
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // bring a mark selected elsewhere (timeline, video) into view
  useEffect(() => {
    const el = box.current; if (!el || selectedId === null) return;
    const i = sorted.findIndex((m) => m.id === selectedId);
    if (i < 0) return;
    const top = i * ROW_H, bottom = top + ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const { start, end } = visibleRange(scrollTop, Math.min(h, 1600), ROW_H, sorted.length);

  return (
    <div className="marks-scroll" ref={box} role="list" aria-label="Marks, newest first"
      onScroll={(e) => { const t = e.currentTarget.scrollTop; cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => setScrollTop(t)); }}>
      {!sorted.length && <div className="empty small">{noVideo ? "No marks." : "No marks yet. Press a marking key while the video plays."}</div>}
      <div style={{ height: sorted.length * ROW_H, position: "relative" }}>
        {sorted.slice(start, end).map((m, i) => (
          <MarkRow key={m.id} m={m} types={types} type={m.marking_type_id === null ? undefined : byId.get(m.marking_type_id)} top={(start + i) * ROW_H} current={m.id === currentId} selected={m.id === selectedId} picking={m.id === pickingId}
            editing={editing === m.id} noVideo={noVideo}
            onEdit={() => setEditing(m.id)}
            onCancel={() => { setEditing(null); onDone(); }}
            onSave={(p) => { setEditing(null); onPatch(m, p); onDone(); }}
            onSeek={onSeek} onPatch={onPatch} onDelete={onDelete} onPlacePoint={onPlacePoint} onClearPoint={onClearPoint} onReplay={onReplay} />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  m: M; types: MarkingType[]; type: MarkingType | undefined; top: number; current: boolean; selected: boolean; picking: boolean; editing: boolean; noVideo: boolean;
  onEdit: () => void; onCancel: () => void; onSave: (p: MarkPatch) => void;
  onSeek: Props["onSeek"]; onPatch: Props["onPatch"]; onDelete: Props["onDelete"];
  onPlacePoint: Props["onPlacePoint"]; onClearPoint: Props["onClearPoint"]; onReplay: Props["onReplay"];
}

const MarkRow = memo(function MarkRow({ m, types, type, top, current, selected, picking, editing, noVideo, onEdit, onCancel, onSave, onSeek, onPatch, onDelete, onPlacePoint, onClearPoint, onReplay }: RowProps) {
  const [typeId, setTypeId] = useState<number | null>(m.marking_type_id);
  const [t, setT] = useState(m.time_s.toFixed(2));
  const tNum = Number(t);
  const valid = t.trim() !== "" && tNum >= 0 && Number.isFinite(tNum);
  const save = () => { if (valid) onSave({ time_s: tNum, ...(typeId !== null && typeId !== m.marking_type_id ? { marking_type_id: typeId } : {}) }); };
  const style = { top, height: ROW_H };
  const hasPoint = m.x !== null && m.y !== null;

  if (editing) {
    return (
      <div className="mrow editing" style={style} role="listitem"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}>
        <select aria-label="Marking" value={typeId ?? ""} onChange={(e) => setTypeId(Number(e.target.value))}>
          {typeId !== null && !activeTypes(types).some((t) => t.id === typeId) && <option value={typeId}>{type?.label ?? "Unknown"} (removed)</option>}
          {activeTypes(types).map((t) => <option key={t.id} value={t.id}>{directionIcon(t.direction)} {t.label}</option>)}
        </select>
        <input aria-label="Time in seconds" aria-invalid={!valid} type="number" min={0} step={0.1} value={t} onChange={(e) => setT(e.target.value)} />
        <Button size="sm" variant="primary" disabled={!valid} onClick={save} aria-label="Save mark">✓</Button>
        <Button size="sm" onClick={onCancel} aria-label="Cancel edit">✕</Button>
      </div>
    );
  }
  const dis = m.pending;
  return (
    <div className={`mrow ${current ? "current" : ""} ${selected ? "selected" : ""} ${picking ? "picking" : ""} ${m.pending ? "pending" : ""}`} style={style} role="listitem" aria-current={current || undefined}>
      {noVideo ? <span className="num">{fmtTime(m.time_s)}</span> : <button className="seeklink num" onClick={() => onSeek(m)} title="Jump to this mark">{fmtTime(m.time_s)}</button>}
      <MarkBadge type={type} />
      {hasPoint && <span className="pin" title="Has a point on the picture" aria-label="Has a point">📍</span>}
      <span className="spacer" />
      <div className="mactions">
        <Button size="sm" variant="ghost" disabled={dis} onClick={() => onPatch(m, { time_s: Math.max(0, +(m.time_s - 0.1).toFixed(3)) })} aria-label="Nudge 0.1 seconds earlier" title="−0.1 s">−</Button>
        <Button size="sm" variant="ghost" disabled={dis} onClick={() => onPatch(m, { time_s: +(m.time_s + 0.1).toFixed(3) })} aria-label="Nudge 0.1 seconds later" title="+0.1 s">+</Button>
        {!noVideo && <Button size="sm" variant="ghost" disabled={dis} onClick={() => onReplay(m)} aria-label="Replay around this mark" title="Replay ±2 s">▶</Button>}
        {!noVideo && <Button size="sm" variant="ghost" disabled={dis} onClick={() => onPlacePoint(m)} aria-label={hasPoint ? "Move point" : "Place point on the picture"} title={hasPoint ? "Move point" : "Place point"}>📍</Button>}
        {hasPoint && !noVideo && <Button size="sm" variant="ghost" disabled={dis} onClick={() => onClearPoint(m)} aria-label="Clear point" title="Clear point">⌀</Button>}
        <Button size="sm" variant="ghost" disabled={dis} onClick={onEdit} aria-label="Edit mark" title="Edit">✎</Button>
        <Button size="sm" variant="ghost" disabled={dis} onClick={() => onDelete(m)} aria-label="Delete mark" title="Delete">✕</Button>
      </div>
    </div>
  );
});

export default memo(MarksList);
