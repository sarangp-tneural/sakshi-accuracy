import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Video } from "../api";
import { fmtClock, fmtTime, recordingProgress } from "../lib/format";
import { Button, EmptyState, LoadError, Spinner } from "./ui/bits";
import { ConfirmDialog } from "./ui/Modal";
import { useToast } from "./ui/Toast";
import UploadZone from "./UploadZone";
import RtspForm from "./RtspForm";
import ExportDialog from "./ExportDialog";

function StatusCell({ v, now }: { v: Video; now: number }) {
  if (v.status === "recording") {
    const p = recordingProgress(v.created_at, v.rtsp_minutes ?? 0, now);
    return (<div><span className="badge recording"><Spinner label="Recording" /> recording</span>
      <div className="small num muted">{fmtClock(p.elapsed)} / {fmtClock(p.total)}</div></div>);
  }
  if (v.status === "processing") return <span className="badge processing"><Spinner label="Processing" /> processing</span>;
  const label = v.status === "ready" && v.source === "rtsp" ? "saved" : v.status;
  return (
    <div>
      <span className={`badge ${v.status}`} title={v.status_reason ?? undefined}>{label}</span>
      {v.status_reason && <div className="small muted" style={{ maxWidth: 360 }}>{v.status_reason}</div>}
    </div>
  );
}

export default function VideosTab({ projectId }: { projectId: number }) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [err, setErr] = useState("");
  const [showRtsp, setShowRtsp] = useState(false);
  const [del, setDel] = useState<Video | null>(null);
  const [exp, setExp] = useState<Video | null>(null);
  const [stopping, setStopping] = useState<Video | null>(null);
  const [now, setNow] = useState(Date.now());
  const toast = useToast();

  const load = useCallback(() => {
    api.videos(projectId).then((v) => { setVideos(v); setErr(""); }).catch((e) => setErr(e.message));
  }, [projectId]);
  useEffect(() => { setVideos(null); load(); }, [load]);

  const busy = videos?.some((v) => v.status === "processing" || v.status === "recording");
  useEffect(() => {
    if (!busy) return;
    const poll = setInterval(load, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [busy, load]);

  return (
    <div className="stack">
      <UploadZone projectId={projectId} onUploaded={load} />
      <div className="row">
        <Button onClick={() => setShowRtsp((s) => !s)} aria-expanded={showRtsp}>● RTSP record</Button>
      </div>
      {showRtsp && <RtspForm projectId={projectId} onStarted={load} onClose={() => setShowRtsp(false)} />}
      {err && <LoadError message={err} onRetry={load} />}
      {videos === null && !err && <div><Spinner /> Loading videos…</div>}
      {videos && videos.length === 0 && <div className="card"><EmptyState title="No videos in this project yet">Upload a file above, or record from an RTSP stream.</EmptyState></div>}
      {videos && videos.length > 0 && (
        <table className="table">
          <thead><tr><th>Name</th><th>Source</th><th>Duration</th><th>Status</th><th>Added</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {videos.map((v) => {
              const openable = v.status === "ready" || v.status === "partial";
              return (
                <tr key={v.id}>
                  <td>{openable ? <Link to={`/videos/${v.id}`}><b>{v.name}</b></Link> : <b>{v.name}</b>}
                    {v.rtsp_url_masked && <div className="small muted">{v.rtsp_url_masked}</div>}</td>
                  <td><span className="badge unknown">{v.source === "rtsp" ? `RTSP · ${v.rtsp_minutes} min` : "upload"}</span></td>
                  <td className="num">{v.duration_s ? fmtTime(v.duration_s) : "—"}</td>
                  <td><StatusCell v={v} now={now} /></td>
                  <td className="small muted">{new Date(v.created_at).toLocaleString()}</td>
                  <td><div className="row" style={{ flexWrap: "nowrap" }}>
                    {openable && <Link className="btn sm primary" to={`/videos/${v.id}`}>Count</Link>}
                    {openable && <Button size="sm" onClick={() => setExp(v)}>Export</Button>}
                    {v.status === "recording" && <Button size="sm" variant="danger" onClick={() => setStopping(v)}>■ Stop</Button>}
                    {v.status !== "recording" && <Button size="sm" variant="danger" onClick={() => setDel(v)}>Delete</Button>}
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {del && (
        <ConfirmDialog title="Delete video?" danger confirmLabel="Delete" message={<>“{del.name}” and all its marks will be permanently deleted.</>}
          onCancel={() => setDel(null)}
          onConfirm={() => { const v = del; setDel(null); api.deleteVideo(v.id).then(() => { toast.success("Video deleted"); load(); }).catch(toast.error); }} />
      )}
      {stopping && (
        <ConfirmDialog title="Stop recording?" confirmLabel="Stop and keep video"
          message={<>Recording stops now and the part recorded so far is saved as a video you can count.</>}
          onCancel={() => setStopping(null)}
          onConfirm={() => { const v = stopping; setStopping(null); api.stopRecording(v.id).then(() => { toast.info("Stopping… saving the video"); load(); }).catch(toast.error); }} />
      )}
      {exp && <ExportDialog videoId={exp.id} videoName={exp.name} onClose={() => setExp(null)} />}
    </div>
  );
}
