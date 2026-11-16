import { memo, useEffect, useMemo, useRef, type RefObject } from "react";
import { fmtClock, fmtTime } from "../lib/format";
import { ensureVisible, fullView, hitMarker, panView, rulerStep, timeToX, visibleSlice, xToTime, zoomView, type View } from "../lib/timelineView";
import { useTick } from "../lib/useTick";
import { Button } from "./ui/bits";

/** color: the marking's own hex colour, or null to use the IN/OUT colour. */
export interface TimelineMark { id: number; time_s: number; direction: "in" | "out" | null; color: string | null; label: string; hasPoint: boolean }

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  marks: TimelineMark[]; // ascending by time
  selectedId: number | null;
  onSelect: (id: number) => void;
}

const RULER = 20; // px reserved at the top for the time ruler
/** Vertical centres of the IN and OUT marker rows for a canvas of height h. Marks with no direction get a third,
 *  middle row, which only exists while there are such marks. */
const rowsFor = (h: number, other: boolean) => {
  const body = h - RULER;
  return other
    ? { in: RULER + body * 0.2, other: RULER + body * 0.5, out: RULER + body * 0.8 }
    : { in: RULER + body * 0.27, other: RULER + body * 0.5, out: RULER + body * 0.73 };
};
const DENSE = 300; // above this many visible marks draw thin lines instead of shapes
const DRAG_PX = 4;
const FOLLOW_PAUSE_MS = 4000;

/** Whole-video timeline on a canvas: drag scrubs, click a marker selects it, Ctrl+wheel zooms, Shift+wheel pans.
 *  Adapted from sakshi-accuracy-automation's AnnotationTimeline; redrawn from refs, never per-frame React state. */
function Timeline({ videoRef, duration, marks, selectedId, onSelect }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const view = useRef<View>(fullView(duration));
  const width = useRef(300);
  const height = useRef(96);
  const dirty = useRef(true);
  const lastPx = useRef(-1);
  const lastSecond = useRef(-1);
  const followPausedUntil = useRef(0);
  const drag = useRef<{ startX: number; marker: number; scrubbing: boolean } | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const raf = useRef(0);
  const colors = useRef({ in: "#6ea8fe", out: "#fb923c", male: "#b79df0", female: "#34d3a4", text: "#9aa4b0", border: "#2f3740", surface: "#1a1f25", fg: "#e8eaed" });
  const hasOther = useMemo(() => marks.some((m) => m.direction === null), [marks]);
  const live = useRef({ marks, selectedId, duration, onSelect, hasOther });
  live.current = { marks, selectedId, duration, onSelect, hasOther };
  const times = useRef<number[]>([]);
  times.current = marks.map((m) => m.time_s);

  useEffect(() => { view.current = fullView(duration); dirty.current = true; }, [duration]);
  useEffect(() => { dirty.current = true; }, [marks, selectedId]);


  // size + colors
  useEffect(() => {
    const c = canvas.current, w = wrap.current; if (!c || !w) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      width.current = Math.max(160, w.clientWidth);
      height.current = Math.max(64, w.clientHeight);
      c.width = Math.round(width.current * dpr); c.height = Math.round(height.current * dpr);
      c.style.width = width.current + "px"; c.style.height = height.current + "px";
      const cs = getComputedStyle(document.documentElement);
      const get = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
      colors.current = { in: get("--in", "#6ea8fe"), out: get("--out", "#fb923c"), male: get("--male", "#b79df0"), female: get("--female", "#34d3a4"),
        text: get("--muted", "#9aa4b0"), border: get("--border", "#2f3740"), surface: get("--surface-2", "#252c34"), fg: get("--text", "#e8eaed") };
      dirty.current = true;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    return () => ro.disconnect();
  }, []);

  const draw = (t: number) => {
    const c = canvas.current; if (!c) return;
    const g = c.getContext("2d")!;
    const dpr = c.width / width.current;
    const W = width.current, H = height.current, v = view.current, col = colors.current;
    const { marks: ms, selectedId: sel, duration: dur, hasOther: other } = live.current;
    const ROW = rowsFor(H, other);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = col.surface; g.fillRect(0, 0, W, H);
    // ruler
    const span = v.end - v.start;
    const step = rulerStep(span, W);
    g.fillStyle = col.text; g.font = "10px system-ui, sans-serif"; g.textAlign = "left";
    for (let s = Math.ceil(v.start / step) * step; s <= v.end; s += step) {
      const x = timeToX(s, v, W);
      g.fillRect(x, 0, 1, 8);
      g.fillText(step < 1 ? s.toFixed(1) + "s" : fmtClock(s), x + 3, 11);
    }
    // row guides
    g.strokeStyle = col.border; g.lineWidth = 1;
    for (const y of other ? [ROW.in, ROW.other, ROW.out] : [ROW.in, ROW.out]) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    g.fillStyle = col.text; g.globalAlpha = 0.55; g.font = "700 10px system-ui, sans-serif";
    g.fillText("▲ IN", 4, ROW.in - 9); g.fillText("▼ OUT", 4, ROW.out - 9);
    if (other) g.fillText("• OTHER", 4, ROW.other - 9);
    g.globalAlpha = 1;
    // markers
    const [lo, hi] = visibleSlice(times.current, v, 0.5);
    const dense = hi - lo > DENSE;
    for (let i = lo; i < hi; i++) {
      const m = ms[i];
      const x = timeToX(m.time_s, v, W), y = ROW[m.direction ?? "other"];
      const isSel = m.id === sel;
      g.fillStyle = m.color ?? (m.direction ? col[m.direction] : col.text);
      if (dense && !isSel) { g.fillRect(x - 1, y - 10, 2, 20); continue; }
      const r = isSel ? 9 : 6.5;
      g.beginPath();
      if (m.hasPoint) { g.moveTo(x, y - r - 1); g.lineTo(x + r + 1, y); g.lineTo(x, y + r + 1); g.lineTo(x - r - 1, y); g.closePath(); } // diamond = has a point
      else g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (isSel) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2); g.stroke(); }
    }
    // playhead
    const px = timeToX(Math.min(Math.max(t, 0), Math.max(dur, 0.001)), v, W);
    g.fillStyle = col.fg; g.fillRect(px - 1, 0, 2, H);
    g.beginPath(); g.moveTo(px - 5, 0); g.lineTo(px + 5, 0); g.lineTo(px, 7); g.closePath(); g.fill();
    lastPx.current = px;
  };

  useTick(() => {
    const v = videoRef.current; if (!v) return;
    const t = v.currentTime, dur = live.current.duration;
    if (!v.paused && Date.now() > followPausedUntil.current) {
      const next = ensureVisible(view.current, dur, t);
      if (next !== view.current) { view.current = next; dirty.current = true; }
    }
    const px = timeToX(t, view.current, width.current);
    if (dirty.current || Math.abs(px - lastPx.current) >= 0.5) { dirty.current = false; draw(t); }
    const sec = Math.round(t);
    if (sec !== lastSecond.current && canvas.current) { lastSecond.current = sec; canvas.current.setAttribute("aria-valuenow", String(sec)); }
  }, 40);

  // Ctrl/Cmd + wheel zooms around the cursor, Shift + wheel pans; a plain wheel scrolls the page
  useEffect(() => {
    const el = canvas.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return;
      e.preventDefault();
      const dur = live.current.duration, r = el.getBoundingClientRect();
      const anchor = xToTime(e.clientX - r.left, view.current, width.current);
      view.current = e.shiftKey && !e.ctrlKey && !e.metaKey
        ? panView(view.current, dur, ((e.deltaY || e.deltaX) / width.current) * (view.current.end - view.current.start))
        : zoomView(view.current, dur, e.deltaY < 0 ? 1.25 : 0.8, anchor);
      followPausedUntil.current = Date.now() + FOLLOW_PAUSE_MS;
      dirty.current = true;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // seeks while dragging are coalesced to one per animation frame
  const seek = (t: number) => {
    pendingSeek.current = Math.min(Math.max(0, t), live.current.duration);
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const v = videoRef.current;
      if (v && pendingSeek.current !== null) v.currentTime = pendingSeek.current;
      pendingSeek.current = null;
      dirty.current = true;
    });
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (x: number, y: number) => hitMarker(live.current.marks, view.current, width.current, x, y, rowsFor(height.current, live.current.hasOther), 12);

  const showTip = (x: number, y: number) => {
    const el = tip.current; if (!el) return;
    const idx = hit(x, y);
    const m = idx >= 0 ? live.current.marks[idx] : null;
    const t = m ? m.time_s : xToTime(x, view.current, width.current);
    el.textContent = m ? `${fmtTime(t)} · ${m.label}${m.hasPoint ? " · 📍" : ""}` : fmtTime(t);
    el.style.left = Math.min(Math.max(0, x - 50), Math.max(0, width.current - 130)) + "px";
    el.style.opacity = "1";
  };

  return (
    <div className="tl">
      <div className="tl-main" ref={wrap}>
        <div className="tl-tip" ref={tip} aria-hidden />
        <canvas ref={canvas} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={0} tabIndex={-1}
          onPointerDown={(e) => {
            const { x, y } = local(e);
            e.currentTarget.setPointerCapture(e.pointerId);
            const marker = hit(x, y);
            drag.current = { startX: x, marker, scrubbing: marker < 0 };
            followPausedUntil.current = 0;
            if (marker < 0) seek(xToTime(x, view.current, width.current));
          }}
          onPointerMove={(e) => {
            const { x, y } = local(e);
            const d = drag.current;
            if (d) {
              if (!d.scrubbing && Math.abs(x - d.startX) > DRAG_PX) d.scrubbing = true;
              if (d.scrubbing) seek(xToTime(x, view.current, width.current));
            }
            showTip(x, y);
          }}
          onPointerUp={(e) => {
            const d = drag.current; drag.current = null;
            if (d && !d.scrubbing && d.marker >= 0) {
              const m = live.current.marks[d.marker];
              live.current.onSelect(m.id);
              seek(m.time_s);
            }
            void e;
          }}
          onPointerCancel={() => { drag.current = null; }}
          onPointerLeave={() => { if (tip.current) tip.current.style.opacity = "0"; }} />
      </div>
      <div className="tl-btns" role="group" aria-label="Timeline zoom">
        <Button size="sm" aria-label="Zoom timeline out" title="Zoom out (Ctrl + wheel)" onClick={() => { view.current = zoomView(view.current, live.current.duration, 0.5, videoRef.current?.currentTime ?? 0); followPausedUntil.current = 0; dirty.current = true; }}>−</Button>
        <Button size="sm" aria-label="Zoom timeline in" title="Zoom in (Ctrl + wheel)" onClick={() => { view.current = zoomView(view.current, live.current.duration, 2, videoRef.current?.currentTime ?? 0); followPausedUntil.current = 0; dirty.current = true; }}>+</Button>
        <Button size="sm" aria-label="Show whole video" title="Whole video" onClick={() => { view.current = fullView(live.current.duration); dirty.current = true; }}>⤢</Button>
      </div>
    </div>
  );
}
export default memo(Timeline);
