import { useCallback, useEffect, useRef, useState } from "react";
import type { Roi } from "../../api";
import type { VirtualLine } from "../../lib/lines";
import { Button, Spinner } from "../ui/bits";
import ImageWithLines from "../lines/ImageWithLines";
import LinesPanel from "../lines/LinesPanel";

/** "Preview camera": one still frame from the stream (optionally refreshed every 3 s). The fetcher decides which camera or link. */
export default function CameraPreview({ fetcher, enabled = true, autoStart = false, lines, onLinesChange, roi, onRoiChange }: {
  fetcher: (signal: AbortSignal) => Promise<string>; enabled?: boolean; autoStart?: boolean;
  lines?: VirtualLine[]; onLinesChange?: (lines: VirtualLine[]) => void; // give both to let the user draw lines on the frame
  roi?: Roi | null; onRoiChange?: (roi: Roi | null) => void; // give onRoiChange to let the user mark the focus area on the frame
}) {
  const canDraw = lines !== undefined && !!onLinesChange;
  const [drawing, setDrawing] = useState(false);
  const [drawingRoi, setDrawingRoi] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const frameRef = useRef<string | null>(null);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher; // always the latest link/camera, even for the auto-refresh

  const show = (next: string | null) => {
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
    frameRef.current = next;
    setFrame(next);
  };
  const grab = useCallback(async () => {
    if (inflight.current) return; // never overlap requests
    const ac = new AbortController();
    inflight.current = ac;
    setLoading(true); setErr("");
    try { show(await fetchRef.current(ac.signal)); }
    catch (x) { if (!ac.signal.aborted) { setErr((x as Error).message); setLive(false); } }
    finally { inflight.current = null; setLoading(false); }
  }, []);

  useEffect(() => { if (autoStart) void grab(); }, [autoStart, grab]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void grab(), 3000);
    return () => clearInterval(t);
  }, [live, grab]);
  useEffect(() => () => { inflight.current?.abort(); if (frameRef.current) URL.revokeObjectURL(frameRef.current); }, []);

  return (
    <div className="stack">
      <div className="row">
        <Button onClick={() => void grab()} disabled={loading || !enabled}>
          {loading ? <><Spinner label="Loading preview" /> Connecting…</> : frame ? "Refresh preview" : "Preview camera"}
        </Button>
        <label className="switch"><input type="checkbox" checked={live} disabled={!frame} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh every 3 s</label>
        {onRoiChange && <Button aria-pressed={drawingRoi} disabled={!frame} onClick={() => { setDrawingRoi((d) => !d); setDrawing(false); }}>🎯 {drawingRoi ? "Done" : `Focus area${roi ? " ✓" : ""}`}</Button>}
        {canDraw && <Button aria-pressed={drawing} disabled={!frame} onClick={() => { setDrawing((d) => !d); setDrawingRoi(false); }}>📏 {drawing ? "Done drawing" : `Draw lines${lines!.length ? ` (${lines!.length})` : ""}`}</Button>}
      </div>
      {err && <p className="alert" role="alert">{err}</p>}
      {frame && (canDraw || onRoiChange)
        ? <ImageWithLines src={frame} alt="Latest frame from the camera" lines={lines ?? []} editing={drawing} roi={roi} editingRoi={drawingRoi} onRoiChange={onRoiChange} selectedId={selectedId} onSelect={setSelectedId} onChange={onLinesChange!} />
        : frame && <img className="rtsp-frame" src={frame} alt="Latest frame from the camera" />}
      {canDraw && drawing && <LinesPanel lines={lines!} selectedId={selectedId} onSelect={setSelectedId} onChange={onLinesChange!} />}
      {canDraw && !drawing && frame && lines!.length > 0 && <span className="small muted">These lines are copied into every video recorded from this camera, where they can still be edited.</span>}
      {onRoiChange && drawingRoi && (
        <div className="row"><span className="small muted">Drag on the picture to draw the focus area, drag inside to move it, a corner to resize. It is copied into every video recorded from this camera.</span>
          <Button size="sm" disabled={!roi} onClick={() => onRoiChange(null)}>Use the whole picture</Button></div>
      )}
      {frame && <span className="small muted">A still frame, not a live video. Check the angle and that people are visible before recording.</span>}
    </div>
  );
}
