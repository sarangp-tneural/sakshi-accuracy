import { useCallback, useEffect, useRef, useState } from "react";
import { api, rtspPreview } from "../api";
import { Button, Field, Spinner } from "./ui/bits";
import { useToast } from "./ui/Toast";

const MAX_MIN = 120;
const QUICK_MINUTES = [5, 15, 30, 60];

export function validateRtsp(url: string, minutes: number): { url?: string; minutes?: string } {
  const e: { url?: string; minutes?: string } = {};
  const u = url.trim();
  if (!u) e.url = "Enter the stream link";
  else if (!/^rtsps?:\/\//i.test(u)) e.url = "Link must start with rtsp:// or rtsps://";
  else if (/\s/.test(u)) e.url = "Link must not contain spaces";
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_MIN) e.minutes = `Whole minutes, 1 to ${MAX_MIN}`;
  return e;
}

export default function RtspForm({ projectId, onStarted }: { projectId: number; onStarted: () => void }) {
  const [url, setUrl] = useState("");
  const [minutesText, setMinutesText] = useState("5"); // string so clearing the field never leaves a stray 0
  const minutes = minutesText.trim() === "" ? NaN : Number(minutesText);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const toast = useToast();
  const errs = validateRtsp(url, minutes);
  const invalid = Object.keys(errs).length > 0;

  // --- preview: a still frame from the camera, refreshed every few seconds while "live" is on ---
  const [frame, setFrame] = useState<string | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [loadingFrame, setLoadingFrame] = useState(false);
  const [live, setLive] = useState(false);
  const inflight = useRef<AbortController | null>(null);
  const frameRef = useRef<string | null>(null);
  const urlRef = useRef(url);
  urlRef.current = url;

  const showFrame = (next: string | null) => {
    if (frameRef.current) URL.revokeObjectURL(frameRef.current);
    frameRef.current = next; setFrame(next);
  };
  const grab = useCallback(async () => {
    if (inflight.current) return; // never overlap requests
    const u = urlRef.current.trim();
    const e = validateRtsp(u, 1).url;
    if (e) { setPreviewErr(e); setLive(false); return; }
    const ac = new AbortController();
    inflight.current = ac;
    setLoadingFrame(true); setPreviewErr("");
    try { showFrame(await rtspPreview(projectId, u, ac.signal)); }
    catch (x) { if (!ac.signal.aborted) { setPreviewErr((x as Error).message); setLive(false); } }
    finally { inflight.current = null; setLoadingFrame(false); }
  }, [projectId]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void grab(), 3000);
    return () => clearInterval(t);
  }, [live, grab]);
  useEffect(() => () => { inflight.current?.abort(); if (frameRef.current) URL.revokeObjectURL(frameRef.current); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true); setServerErr("");
    if (invalid) return;
    setBusy(true);
    try {
      const v = await api.rtsp(projectId, url.trim(), minutes);
      toast.success(`Recording started: ${v.rtsp_url_masked ?? "stream"} for ${minutes} min`);
      onStarted();
      // ready for the next camera, and no accidental double start
      setUrl(""); setTouched(false); setLive(false); showFrame(null); setPreviewErr("");
    } catch (x) { setServerErr((x as Error).message); } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Record from camera">
      <p className="muted small" style={{ margin: 0 }}>Paste the RTSP link, pick how long, and it records and saves by itself.</p>
      <Field label="Stream link" htmlFor="rtsp-url" error={touched ? errs.url : null} hint="The password is stored encrypted and never shown again.">
        <input id="rtsp-url" className="rec-input" type="text" autoComplete="off" spellCheck={false} placeholder="rtsp://user:pass@host:554/stream" value={url}
          aria-invalid={touched && !!errs.url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setTouched(true)} />
      </Field>
      <Field label="How long to record" htmlFor="rtsp-min" error={touched ? errs.minutes : null} hint={`1 to ${MAX_MIN} minutes. It stops by itself; you can also stop it any time.`}>
        <div className="row">
          <input id="rtsp-min" className="rec-input" type="number" min={1} max={MAX_MIN} step={1} value={minutesText} style={{ width: 110 }}
            aria-invalid={touched && !!errs.minutes} onChange={(e) => setMinutesText(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))} />
          <span>minutes</span>
          <div className="quick" role="group" aria-label="Quick durations">
            {QUICK_MINUTES.map((m) => <Button key={m} size="sm" aria-pressed={minutes === m} onClick={() => setMinutesText(String(m))}>{m}</Button>)}
          </div>
        </div>
      </Field>
      <div className="stack">
        <div className="row">
          <Button onClick={() => void grab()} disabled={loadingFrame || !!validateRtsp(url, 1).url}>{loadingFrame ? <><Spinner label="Loading preview" /> Connecting…</> : frame ? "Refresh preview" : "Preview camera"}</Button>
          <label className="switch"><input type="checkbox" checked={live} disabled={!frame} onChange={(e) => setLive(e.target.checked)} /> Auto-refresh every 3 s</label>
        </div>
        {previewErr && <p className="alert" role="alert">{previewErr}</p>}
        {frame && <img className="rtsp-frame" src={frame} alt="Latest frame from the camera" />}
        {frame && <span className="small muted">A still frame, not a live video. Check the angle and that people are visible before recording.</span>}
      </div>
      {serverErr && <p className="alert" role="alert">{serverErr}</p>}
      <Button variant="primary" size="lg" type="submit" disabled={busy} className="rec-go">
        <span className="rec-dot sm" aria-hidden /> {busy ? "Starting…" : `Start recording${minutes >= 1 && minutes <= MAX_MIN ? ` · ${minutes} min` : ""}`}
      </Button>
    </form>
  );
}
