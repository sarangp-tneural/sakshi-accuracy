import { useEffect, useId, useState } from "react";
import type { Camera } from "../../api";
import { RECORDER_HINT, attemptingText, lengthOptions, recordingText, startLabel, waitingForRecorder } from "../../lib/cameras";
import { fmtDateShort } from "../../lib/format";
import { Button, Spinner } from "../ui/bits";
import RowMenu from "../videos/RowMenu";

interface Props {
  camera: Camera;
  now: number;
  starting: boolean;
  onStart: (minutes: number) => void;
  onStop: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** One saved camera: Start records with the saved length. The picker changes it for this run only, then it goes back to the default. */
export default function CameraCard({ camera: c, now, starting, onStart, onStop, onPreview, onEdit, onDelete }: Props) {
  const [minutes, setMinutes] = useState(c.default_minutes);
  useEffect(() => { setMinutes(c.default_minutes); }, [c.default_minutes]); // follows Edit
  const selectId = useId();
  const status = c.recording_status;
  const attempt = status === "connecting" ? attemptingText(c.recording_note, c.recording_created_at, now) : null;
  return (
    <article className="camcard" aria-label={`Camera ${c.name}`}>
      <div className="camhead">
        <h3 title={c.name}>{c.name}</h3>
        <RowMenu label={`More actions for camera ${c.name}`} items={[
          { label: "Preview…", onSelect: onPreview },
          { label: "Edit…", onSelect: onEdit },
          { label: "Delete…", danger: true, onSelect: onDelete },
        ]} />
      </div>
      <code className="cammask" title="The password is hidden">{c.rtsp_url_masked}</code>
      <p className="small muted camlast">{c.last_recorded_at ? `Last recorded ${fmtDateShort(c.last_recorded_at)}` : "Never recorded"}</p>
      {status === "recording" && (
        <div className="camlive" role="status">
          <span className="badge recording"><span className="live-dot" aria-hidden /> Recording</span>
          <span className="num" title={waitingForRecorder(c.recording_started_at, c.recording_created_at, now) ? RECORDER_HINT : undefined}>{recordingText(c.recording_started_at, c.recording_minutes, now, c.recording_created_at)}</span>
          <span className="spacer" />
          <Button size="sm" variant="danger" onClick={onStop}>■ Stop</Button>
        </div>
      )}
      {attempt && (
        <div className="camlive" role="status">
          <span className="badge connecting"><Spinner label="Attempting" /> Attempting</span>
          <span className={`num ${attempt.warn ? "warnline" : ""}`} title={attempt.warn ? RECORDER_HINT : undefined}>{attempt.line}</span>
          <span className="spacer" />
          <Button size="sm" variant="danger" onClick={onStop}>Cancel</Button>
          {attempt.detail && !attempt.warn && <div className="small muted camnote" title={attempt.detail}>{attempt.detail}</div>}
        </div>
      )}
      {!status && (
        <div className="camact">
          <Button variant="primary" disabled={starting} onClick={() => { onStart(minutes); setMinutes(c.default_minutes); }}>
            {starting ? "Starting…" : <><span className="rec-dot sm" aria-hidden /> {startLabel(minutes)}</>}
          </Button>
          <label className="sr-only" htmlFor={selectId}>Length of this recording</label>
          <select id={selectId} value={minutes} disabled={starting} onChange={(e) => setMinutes(Number(e.target.value))}>
            {lengthOptions(c.default_minutes).map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
      )}
    </article>
  );
}
