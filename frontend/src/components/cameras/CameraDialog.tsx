import { useState } from "react";
import { api, cameraPreview, rtspPreview, type Camera, type Roi } from "../../api";
import type { VirtualLine } from "../../lib/lines";
import { MAX_NAME, QUICK_MINUTES, validateCamera } from "../../lib/cameras";
import { MAX_MINUTES, validateRtsp } from "../../lib/rtsp";
import { Button, Field } from "../ui/bits";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import CameraPreview from "./CameraPreview";

/** Add a camera, or edit one. When editing, the saved link stays hidden (masked) until you choose to change it. */
export default function CameraDialog({ projectId, camera, onSaved, onClose }: { projectId: number; camera?: Camera; onSaved: () => void; onClose: () => void }) {
  const editing = !!camera;
  const [name, setName] = useState(camera?.name ?? "");
  const [url, setUrl] = useState("");
  const [changeLink, setChangeLink] = useState(!editing);
  const [minutesText, setMinutesText] = useState(String(camera?.default_minutes ?? 30));
  const minutes = minutesText.trim() === "" ? NaN : Number(minutesText);
  const [lines, setLines] = useState<VirtualLine[]>(camera?.lines ?? []);
  const [roi, setRoi] = useState<Roi | null>(camera?.roi ?? null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameErr, setNameErr] = useState("");
  const [serverErr, setServerErr] = useState("");
  const toast = useToast();

  const errs = validateCamera({ name, url: changeLink ? url : "", minutes }, editing);
  const usingSaved = editing && !changeLink;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true); setNameErr(""); setServerErr("");
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (camera) {
        await api.updateCamera(camera.id, { name: name.trim(), default_minutes: minutes, ...(changeLink && url.trim() ? { url: url.trim() } : {}) });
        if (JSON.stringify(lines) !== JSON.stringify(camera.lines ?? [])) await api.putCameraLines(camera.id, lines);
        if (JSON.stringify(roi) !== JSON.stringify(camera.roi ?? null)) await api.putCameraRoi(camera.id, roi);
      } else {
        const created = await api.createCamera(projectId, { name: name.trim(), url: url.trim(), default_minutes: minutes });
        if (lines.length) await api.putCameraLines(created.id, lines);
        if (roi) await api.putCameraRoi(created.id, roi);
      }
      toast.success(editing ? "Camera updated" : "Camera saved");
      onSaved(); onClose();
    } catch (x) {
      const m = (x as Error).message;
      if (/already exists/i.test(m)) setNameErr(m); else setServerErr(m);
    } finally { setBusy(false); }
  }

  return (
    <Modal title={editing ? "Edit camera" : "Add camera"} onClose={onClose} wide>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Name" htmlFor="cam-name" error={nameErr || (touched ? errs.name : null)} hint="For example Entrance or Billing counter.">
          <input id="cam-name" type="text" maxLength={MAX_NAME} autoComplete="off" value={name} aria-invalid={!!(nameErr || (touched && errs.name))} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>

        {usingSaved ? (
          <div className="field">
            <span className="label">Stream link</span>
            <div className="row">
              <code className="cammask">{camera!.rtsp_url_masked}</code>
              <Button size="sm" onClick={() => setChangeLink(true)}>Change link</Button>
            </div>
            <span className="hint">The saved link and password are never shown. Change the link only if the camera changed.</span>
          </div>
        ) : (
          <Field label={editing ? "New stream link" : "Stream link"} htmlFor="cam-url" error={touched ? errs.url : null} hint="The password is stored encrypted and never shown again.">
            <input id="cam-url" className="rec-input" type="text" autoComplete="off" spellCheck={false} placeholder="rtsp://user:pass@host:554/stream  or  http://host/latest/ch9.jpg" value={url}
              aria-invalid={touched && !!errs.url} onChange={(e) => setUrl(e.target.value)} />
            {editing && <div><Button size="sm" variant="ghost" onClick={() => { setChangeLink(false); setUrl(""); }}>Keep the saved link</Button></div>}
          </Field>
        )}

        <Field label="Default recording length" htmlFor="cam-min" error={touched ? errs.minutes : null} hint={`1 to ${MAX_MINUTES} minutes. You can pick another length for a single recording on the camera card.`}>
          <div className="row">
            <input id="cam-min" type="number" min={1} max={MAX_MINUTES} step={1} value={minutesText} style={{ width: 110 }} aria-invalid={touched && !!errs.minutes}
              onChange={(e) => setMinutesText(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))} />
            <span>minutes</span>
            <div className="quick" role="group" aria-label="Quick lengths">
              {QUICK_MINUTES.map((m) => <Button key={m} size="sm" aria-pressed={minutes === m} onClick={() => setMinutesText(String(m))}>{m}</Button>)}
            </div>
          </div>
        </Field>

        <CameraPreview
          fetcher={(signal) => (usingSaved ? cameraPreview(camera!.id, signal) : rtspPreview(projectId, url.trim(), signal))}
          enabled={usingSaved || !validateRtsp(url, 1).url} lines={lines} onLinesChange={setLines} roi={roi} onRoiChange={setRoi} />
        {serverErr && <p className="alert" role="alert">{serverErr}</p>}
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Save camera"}</Button>
        </div>
      </form>
    </Modal>
  );
}
