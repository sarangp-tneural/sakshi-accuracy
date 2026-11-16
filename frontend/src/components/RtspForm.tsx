import { useState } from "react";
import { api, rtspPreview } from "../api";
import { MAX_NAME, QUICK_MINUTES } from "../lib/cameras";
import { MAX_MINUTES, validateRtsp } from "../lib/rtsp";
import CameraPreview from "./cameras/CameraPreview";
import { Button, Field } from "./ui/bits";
import { useToast } from "./ui/Toast";

/** One-off recording from any RTSP link or snapshot (picture) address. Tick "Save as a camera" to keep the link for one-click recordings later. */
export default function RtspForm({ projectId, onStarted }: { projectId: number; onStarted: () => void }) {
  const [url, setUrl] = useState("");
  const [minutesText, setMinutesText] = useState("5"); // string so clearing the field never leaves a stray 0
  const minutes = minutesText.trim() === "" ? NaN : Number(minutesText);
  const [save, setSave] = useState(false);
  const [camName, setCamName] = useState("");
  const [savedCameraId, setSavedCameraId] = useState<number | null>(null); // saved already, but the recording did not start: retry without saving twice
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const [nameErr, setNameErr] = useState("");
  const toast = useToast();
  const errs = validateRtsp(url, minutes);
  const nameMissing = save && !savedCameraId && !camName.trim() ? "Give the camera a name" : camName.trim().length > MAX_NAME ? `Max ${MAX_NAME} characters` : "";
  const invalid = Object.keys(errs).length > 0 || !!nameMissing;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true); setServerErr(""); setNameErr("");
    if (invalid) return;
    setBusy(true);
    try {
      let v;
      if (save) {
        let id = savedCameraId;
        if (id === null) {
          try {
            id = (await api.createCamera(projectId, { name: camName.trim(), url: url.trim(), default_minutes: minutes })).id;
            setSavedCameraId(id);
          } catch (x) {
            const m = (x as Error).message;
            if (/already exists/i.test(m)) { setNameErr(m); return; }
            throw x;
          }
        }
        v = await api.recordCamera(id, minutes);
      } else {
        v = await api.rtsp(projectId, url.trim(), minutes);
      }
      toast.success(`Recording started: ${v.camera_name ?? v.rtsp_url_masked ?? "stream"} for ${minutes} min${save ? ". Camera saved." : ""}`);
      onStarted();
    } catch (x) {
      setServerErr(savedCameraId !== null || save ? `${(x as Error).message} (the camera was saved; Start it from the Cameras list)` : (x as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate aria-label="Record from camera">
      <p className="muted small" style={{ margin: 0 }}>Paste the camera link (rtsp:// or a picture address like http://host/latest/ch9.jpg), pick how long, and it records and saves by itself.</p>
      <Field label="Stream link" htmlFor="rtsp-url" error={touched ? errs.url : null} hint="The password is stored encrypted and never shown again.">
        <input id="rtsp-url" className="rec-input" type="text" autoComplete="off" spellCheck={false} placeholder="rtsp://user:pass@host:554/stream  or  http://host/latest/ch9.jpg" value={url}
          aria-invalid={touched && !!errs.url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setTouched(true)} />
      </Field>
      <Field label="How long to record" htmlFor="rtsp-min" error={touched ? errs.minutes : null} hint={`1 to ${MAX_MINUTES} minutes. It stops by itself; you can also stop it any time.`}>
        <div className="row">
          <input id="rtsp-min" className="rec-input" type="number" min={1} max={MAX_MINUTES} step={1} value={minutesText} style={{ width: 110 }}
            aria-invalid={touched && !!errs.minutes} onChange={(e) => setMinutesText(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))} />
          <span>minutes</span>
          <div className="quick" role="group" aria-label="Quick durations">
            {QUICK_MINUTES.map((m) => <Button key={m} size="sm" aria-pressed={minutes === m} onClick={() => setMinutesText(String(m))}>{m}</Button>)}
          </div>
        </div>
      </Field>

      <div className="savebox">
        <label className="switch"><input type="checkbox" checked={save || savedCameraId !== null} disabled={savedCameraId !== null} onChange={(e) => setSave(e.target.checked)} /> Save as a camera for this project (next time: one click)</label>
        {(save || savedCameraId !== null) && (
          <Field label="Camera name" htmlFor="rtsp-camname" error={nameErr || (touched ? nameMissing : null)}>
            <input id="rtsp-camname" type="text" maxLength={MAX_NAME} placeholder="e.g. Entrance" value={camName} disabled={savedCameraId !== null}
              aria-invalid={!!(nameErr || (touched && nameMissing))} onChange={(e) => setCamName(e.target.value)} />
          </Field>
        )}
      </div>

      <CameraPreview fetcher={(signal) => rtspPreview(projectId, url.trim(), signal)} enabled={!validateRtsp(url, 1).url} />
      {serverErr && <p className="alert" role="alert">{serverErr}</p>}
      <Button variant="primary" size="lg" type="submit" disabled={busy} className="rec-go">
        <span className="rec-dot sm" aria-hidden /> {busy ? "Starting…" : `Start recording${minutes >= 1 && minutes <= MAX_MINUTES ? ` · ${minutes} min` : ""}`}
      </Button>
    </form>
  );
}
