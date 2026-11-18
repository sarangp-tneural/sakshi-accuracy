import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from "react";
import { containRect, normToStage, stageToNorm } from "../lib/contentRect";
import { medianGap, plausibleFrameGap, stepTarget } from "../lib/frameStep";
import { visibleSlice } from "../lib/timelineView";
import { useTick } from "../lib/useTick";
import { IDENTITY, panBy, zoomAt, type Transform } from "../lib/viewport";
import type { Roi } from "../api";
import { overlayRect, type VirtualLine } from "../lib/lines";
import { Button } from "./ui/bits";
import LinesOverlay from "./lines/LinesOverlay";
import RoiOverlay from "./lines/RoiOverlay";

export interface PointMark { id: number; time_s: number; direction: "in" | "out" | null; color: string | null; label: string; x: number; y: number }
export interface ViewportHandle { step: (dir: 1 | -1, frames?: number) => void }

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  src: string;
  fps: number | null;
  points: PointMark[]; // marks that have a point, ascending by time
  selectedId: number | null;
  showPoints: boolean;
  muted: boolean;
  pickMode: boolean;
  lines: VirtualLine[]; // always drawn
  roi: Roi | null; // the focus area (shown only while editRoi)
  editRoi: boolean;
  onRoiChange: (roi: Roi) => void;
  editLines: boolean; // when on, dragging on the picture draws / edits lines instead of play + pan
  selectedLineId: string | null;
  onSelectLine: (id: string | null) => void;
  onLinesChange: (lines: VirtualLine[]) => void;
  onPick: (x: number, y: number) => void;
  onToggle: () => void; // plain click on the picture: play / pause
  onLoadedMetadata: (v: HTMLVideoElement) => void;
  onPlay: () => void;
  onPause: () => void;
  children?: ReactNode; // the popup lives here: it must not scale with the zoom
}

const POINT_WINDOW_S = 2; // points of marks within this many video-seconds of the playhead are drawn
const DRAG_PX = 4;

/** The stage: video (zoom 1x-8x with Ctrl+wheel, drag to pan), crisp overlay for points, click-to-pick, frame stepping. */
const VideoViewport = forwardRef<ViewportHandle, Props>(function VideoViewport(
  { videoRef, stageRef, src, fps, points, selectedId, showPoints, muted, pickMode, roi, editRoi, onRoiChange, lines, editLines, selectedLineId, onSelectLine, onLinesChange, onPick, onToggle, onLoadedMetadata, onPlay, onPause, children }, handle) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [tr, setTr] = useState<Transform>(IDENTITY);
  const trRef = useRef(tr); trRef.current = tr;
  const [layout, setLayout] = useState({ w: 0, h: 0, vw: 0, vh: 0 }); // stage and video size, to place the lines overlay
  const syncLayout = useCallback(() => {
    const st = stageRef.current, v = videoRef.current; if (!st) return;
    setLayout((o) => (o.w === st.clientWidth && o.h === st.clientHeight && o.vw === (v?.videoWidth ?? 0) && o.vh === (v?.videoHeight ?? 0)
      ? o : { w: st.clientWidth, h: st.clientHeight, vw: v?.videoWidth ?? 0, vh: v?.videoHeight ?? 0 }));
  }, [stageRef, videoRef]);
  const drag = useRef<{ x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  const live = useRef({ points, selectedId, showPoints, pickMode, onPick, onToggle, fps });
  live.current = { points, selectedId, showPoints, pickMode, onPick, onToggle, fps };
  const gaps = useRef<number[]>([]);
  const colors = useRef({ in: "#6ea8fe", out: "#fb923c", male: "#b79df0", female: "#34d3a4", unknown: "#9aa4b0" });
  const drewSomething = useRef(false);
  const dirty = useRef(true);

  // ---- seeks are sent one at a time ----
  // Setting currentTime again while a seek is still running makes the browser cancel it, so a held key would
  // freeze the picture until release. Instead: one seek in flight; later presses only move the wanted target,
  // and the next seek starts the moment the previous one has finished (the picture updates at the decoder's pace).
  const seek = useRef<{ busy: boolean; wanted: number | null; timer: number | undefined }>({ busy: false, wanted: null, timer: undefined });
  const issueSeek = useCallback((t: number) => {
    const v = videoRef.current, q = seek.current; if (!v) return;
    q.busy = true;
    window.clearTimeout(q.timer);
    q.timer = window.setTimeout(() => finishSeek(), 1500); // safety: never wait forever for a 'seeked' that doesn't come
    v.currentTime = t;
  }, [videoRef]);
  const finishSeek = useCallback(() => {
    const q = seek.current;
    window.clearTimeout(q.timer);
    q.busy = false;
    if (q.wanted !== null) { const t = q.wanted; q.wanted = null; issueSeek(t); }
  }, [issueSeek]);
  useEffect(() => () => window.clearTimeout(seek.current.timer), []);

  // ---- frame stepping: median of measured frame gaps, else 1/fps ----
  const frameStep = useCallback(() => medianGap(gaps.current) ?? 1 / (live.current.fps && live.current.fps > 0 ? live.current.fps : 30), []);
  useImperativeHandle(handle, () => ({
    step(dir, frames = 1) {
      const v = videoRef.current; if (!v) return;
      v.pause();
      const q = seek.current;
      // while a seek runs, currentTime already reports its target, so keep accumulating from the wanted target if there is one
      const base = q.wanted ?? v.currentTime;
      const target = Math.min(stepTarget(base, frameStep(), dir, frames), v.duration || Infinity);
      if (q.busy) q.wanted = target; else issueSeek(target);
    },
  }), [videoRef, frameStep, issueSeek]);

  useEffect(() => {
    const v = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, m: { mediaTime: number }) => void) => number; cancelVideoFrameCallback?: (id: number) => void }) | null;
    if (!v?.requestVideoFrameCallback) return;
    let last = -1, id = 0;
    const cb = (_: number, m: { mediaTime: number }) => {
      // Only frames shown by normal playback at <=1x are one frame apart. Frames shown after a seek (paused stepping,
      // scrubbing) can be many frames apart, and at 4x the browser may skip frames: neither says anything about the frame time.
      const nominal = live.current.fps && live.current.fps > 0 ? 1 / live.current.fps : null;
      if (!v.paused && !v.seeking && v.playbackRate <= 1 && last >= 0 && plausibleFrameGap(m.mediaTime - last, nominal)) {
        gaps.current.push(m.mediaTime - last);
        if (gaps.current.length > 15) gaps.current.shift();
      }
      last = m.mediaTime;
      id = v.requestVideoFrameCallback!(cb);
    };
    id = v.requestVideoFrameCallback(cb);
    const forget = () => { last = -1; }; // a seek breaks the sequence
    v.addEventListener("seeking", forget);
    return () => { v.cancelVideoFrameCallback?.(id); v.removeEventListener("seeking", forget); };
  }, [videoRef]);

  // ---- geometry helpers ----
  const picture = () => {
    const st = stageRef.current, v = videoRef.current;
    return containRect(st?.clientWidth ?? 0, st?.clientHeight ?? 0, v?.videoWidth ?? 0, v?.videoHeight ?? 0);
  };

  // ---- Ctrl/Cmd + wheel zoom (native non-passive so the browser does not zoom the whole page) ----
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setTr((t) => zoomAt(t, e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top, r.width, r.height));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [stageRef]);

  // ---- pointer: click toggles play (or picks), drag pans when zoomed ----
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-ui]")) { drag.current = null; return; }
    drag.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    if (trRef.current.scale > 1) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_PX) d.moved = true;
    if (d.moved && trRef.current.scale > 1) {
      const r = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      setTr((t) => panBy(t, dx, dy, r.width, r.height));
    }
    d.x = e.clientX; d.y = e.clientY;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (!d || d.moved) return;
    const L = live.current;
    if (L.pickMode) {
      const r = e.currentTarget.getBoundingClientRect();
      const p = stageToNorm(e.clientX - r.left, e.clientY - r.top, picture(), trRef.current);
      if (p.inside) L.onPick(p.x, p.y); // a click on the black bars is ignored
      return;
    }
    L.onToggle();
  };

  // ---- overlay canvas: sized stage x DPR, transform applied while drawing, so it is crisp at any zoom ----
  useEffect(() => {
    const st = stageRef.current, c = canvas.current; if (!st || !c) return;
    const fit = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(st.clientWidth * dpr)); c.height = Math.max(1, Math.round(st.clientHeight * dpr));
      c.style.width = st.clientWidth + "px"; c.style.height = st.clientHeight + "px";
      const cs = getComputedStyle(document.documentElement);
      const get = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
      colors.current = { in: get("--in", "#6ea8fe"), out: get("--out", "#fb923c"), male: get("--male", "#b79df0"), female: get("--female", "#34d3a4"), unknown: get("--unknown", "#9aa4b0") };
      dirty.current = true;
      syncLayout();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(st);
    return () => ro.disconnect();
  }, [stageRef, syncLayout]);
  useEffect(() => { dirty.current = true; }, [points, selectedId, showPoints, tr]);

  useTick(() => {
    const c = canvas.current, v = videoRef.current; if (!c || !v) return;
    const L = live.current;
    const t = v.currentTime;
    const times = L.showPoints ? L.points.map((p) => p.time_s) : [];
    const [lo, hi] = L.showPoints ? visibleSlice(times, { start: t - POINT_WINDOW_S, end: t + POINT_WINDOW_S }) : [0, 0];
    if (lo >= hi && !drewSomething.current && !dirty.current) return; // nothing to draw, nothing to clear
    const g = c.getContext("2d")!;
    const dpr = c.width / Math.max(1, c.clientWidth);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, c.width, c.height);
    dirty.current = false;
    drewSomething.current = false;
    if (lo >= hi) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pic = picture();
    const w = c.clientWidth, h = c.clientHeight;
    g.font = "700 11px system-ui, sans-serif"; g.textAlign = "center";
    for (let i = lo; i < hi; i++) {
      const p = L.points[i];
      const s = normToStage(p.x, p.y, pic, trRef.current);
      if (s.x < -20 || s.y < -20 || s.x > w + 20 || s.y > h + 20) continue;
      const sel = p.id === L.selectedId;
      const alpha = sel ? 1 : Math.max(0.3, 1 - Math.abs(p.time_s - t) / POINT_WINDOW_S);
      const r = sel ? 11 : 8;
      g.globalAlpha = alpha;
      if (sel) { g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.arc(s.x, s.y, r + 5, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = p.color ?? (p.direction ? colors.current[p.direction] : colors.current.unknown); g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgba(0,0,0,.7)"; g.lineWidth = 3; g.stroke();
      const label = p.label.length > 16 ? p.label.slice(0, 15) + "…" : p.label;
      g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,.75)"; g.strokeText(label, s.x, s.y - r - 6);
      g.fillStyle = "#fff"; g.fillText(label, s.x, s.y - r - 6);
      drewSomething.current = true;
    }
    g.globalAlpha = 1;
  }, 33);

  return (
    <div className={`stage ${pickMode ? "picking" : editLines || editRoi ? "linedit" : tr.scale > 1 ? "zoomed" : ""}`} ref={stageRef} tabIndex={-1} aria-label="Video player"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }}>
      <div className="vlayer" style={{ transform: `translate(${tr.tx}px, ${tr.ty}px) scale(${tr.scale})` }}>
        <video ref={videoRef} src={src} preload="auto" playsInline muted={muted}
          onLoadedMetadata={(e) => { onLoadedMetadata(e.currentTarget); dirty.current = true; syncLayout(); }} onSeeked={finishSeek} onPlay={onPlay} onPause={onPause} />
      </div>
      <canvas ref={canvas} className="overlay" aria-hidden />
      {layout.vw > 0 && (lines.length > 0 || editLines) && (
        <LinesOverlay lines={lines} editing={editLines} selectedId={selectedLineId} onSelect={onSelectLine} onChange={onLinesChange}
          box={overlayRect(containRect(layout.w, layout.h, layout.vw, layout.vh), tr)} />
      )}
      {layout.vw > 0 && editRoi && <RoiOverlay roi={roi} onChange={onRoiChange} box={overlayRect(containRect(layout.w, layout.h, layout.vw, layout.vh), tr)} />}
      {pickMode && <div className="pickbanner" role="status">📍 Click where this person is · Esc to cancel</div>}
      {tr.scale > 1 && (
        <div className="zoombadge" data-ui>
          <span className="num">{tr.scale.toFixed(1)}×</span>
          <Button size="sm" onClick={() => setTr(IDENTITY)} aria-label="Reset zoom">Reset</Button>
        </div>
      )}
      {children}
    </div>
  );
});
export default VideoViewport;
