import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, cameraPreview, type Camera, type Video } from "../api";
import { useCameras } from "../hooks/useCameras";
import { useNow } from "../hooks/useNow";
import { useUploads } from "../hooks/useUploads";
import { useVideoList } from "../hooks/useVideoList";
import { lastPage, hasActiveFilters, rangeLabel, type StatusKey } from "../lib/videoFilters";
import { fmtBytes } from "../lib/format";
import { deleteWarning, isActive, removeFileWarning, stopDialog, stopMessage } from "../lib/videoRow";
import CameraDialog from "./cameras/CameraDialog";
import CameraPreview from "./cameras/CameraPreview";
import CameraStrip from "./cameras/CameraStrip";
import ExportDialog from "./ExportDialog";
import ProjectHeader from "./ProjectHeader";
import { Button, EmptyState, LoadError, Spinner } from "./ui/bits";
import { ConfirmDialog, Modal } from "./ui/Modal";
import { useToast } from "./ui/Toast";
import { RecordDialog, UploadDialog } from "./videos/AddVideoDialogs";
import DropOverlay from "./videos/DropOverlay";
import StatusChips from "./videos/StatusChips";
import VideosToolbar from "./videos/VideosToolbar";
import VideoTable from "./videos/VideoTable";

export default function VideosTab({ projectId, name }: { projectId: number; name: string }) {
  const { filters, update, clear, data, loading, error, reload, reloadLoud } = useVideoList(projectId);
  const toast = useToast();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<"upload" | "record" | null>(null);
  const [del, setDel] = useState<Video | null>(null);
  const [rmFile, setRmFile] = useState<Video | null>(null);
  const [conv, setConv] = useState<Video | null>(null);
  const [exp, setExp] = useState<Video | null>(null);
  const [stopping, setStopping] = useState<{ id: number; name: string; attempting: boolean } | null>(null);
  const { cameras, reload: reloadCameras } = useCameras(projectId);
  const camNow = useNow(cameras?.some((c) => c.recording_video_id !== null) ?? false);
  const [startingCam, setStartingCam] = useState<number | null>(null);
  const [camDialog, setCamDialog] = useState<{ camera?: Camera } | null>(null);
  const [camDel, setCamDel] = useState<Camera | null>(null);
  const [camPreview, setCamPreview] = useState<Camera | null>(null);
  const [now, setNow] = useState(Date.now());

  const uploads = useUploads(projectId, useCallback(() => { toast.success("Upload complete. Preparing the video…"); reload(); }, [toast, reload]));

  // elapsed time of a live recording (and of a conversion in progress) ticks locally; the server is only polled while something is busy
  const anyRecording = data?.items.some((v) => isActive(v) || v.status === "processing") ?? false;
  useEffect(() => {
    if (!anyRecording) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRecording]);

  const addFiles = useCallback((files: File[]) => {
    const rejected = uploads.add(files);
    rejected.forEach((m) => toast.error(new Error(m)));
    if (files.length > rejected.length) setDialog(null);
  }, [uploads, toast]);

  const startCamera = async (c: Camera, minutes: number) => {
    setStartingCam(c.id);
    try {
      await api.recordCamera(c.id, minutes);
      toast.success(`Recording started: ${c.name} for ${minutes} min`);
      reload();
    } catch (e) { toast.error(e); }
    finally { setStartingCam(null); reloadCameras(); }
  };

  const toggleStatus = (s: StatusKey) => update({ status: filters.status.includes(s) ? filters.status.filter((x) => x !== s) : [...filters.status, s] });
  const active = hasActiveFilters(filters);
  const total = data?.total ?? 0;
  const pages = data ? lastPage(total, data.page_size) : 1;
  const projectEmpty = !!data && data.status_counts.all === 0 && !active && uploads.items.length === 0;

  return (
    <div className="stack">
      <ProjectHeader pid={projectId} name={name} tab="videos" right={
        <div className="row">
          <Button variant="primary" onClick={() => setDialog("upload")}>+ Upload video</Button>
          <Button onClick={() => setDialog("record")}><span className="rec-dot sm" aria-hidden /> Record from camera</Button>
        </div>
      } />

      {cameras && (
        <CameraStrip cameras={cameras} now={camNow} startingId={startingCam}
          onAdd={() => setCamDialog({})} onStart={startCamera}
          onStop={(c) => c.recording_video_id !== null && setStopping({ id: c.recording_video_id, name: c.name, attempting: c.recording_status === "connecting" })}
          onPreview={setCamPreview} onEdit={(c) => setCamDialog({ camera: c })} onDelete={setCamDel} />
      )}

      {error && <LoadError message={error} onRetry={reloadLoud} />}
      {!data && !error && <div><Spinner /> Loading videos…</div>}

      {projectEmpty && (
        <div className="card">
          <EmptyState title="No videos in this project yet">
            <p style={{ margin: "0 0 12px" }}>Upload a file, drag one onto this page, or record from an RTSP camera.</p>
            <div className="row" style={{ justifyContent: "center" }}>
              <Button variant="primary" onClick={() => setDialog("upload")}>+ Upload video</Button>
              <Button onClick={() => setDialog("record")}><span className="rec-dot sm" aria-hidden /> Record from camera</Button>
            </div>
          </EmptyState>
        </div>
      )}

      {data && !projectEmpty && (
        <>
          <VideosToolbar filters={filters} update={update} clear={clear} />
          <StatusChips counts={data.status_counts} selected={filters.status} onToggle={toggleStatus} onAll={() => update({ status: [] })} />

          {data.items.length === 0 && uploads.items.length === 0 ? (
            <div className="card">
              <EmptyState title="No videos match these filters">
                <Button variant="primary" onClick={clear}>Clear filters</Button>
              </EmptyState>
            </div>
          ) : (
            <VideoTable items={data.items} uploads={uploads.items} now={now} dim={loading}
              onCancelUpload={uploads.cancel} onOpen={(v) => nav(`/videos/${v.id}`)} onStop={(v) => setStopping({ id: v.id, name: v.name, attempting: v.status === "connecting" })} onExport={setExp} onDelete={setDel} onRemoveFile={setRmFile} onConvert={setConv} />
          )}

          {(total > data.page_size || filters.page > 1) && (
            <nav className="pager" aria-label="Pages">
              <span className="muted small" role="status">Showing {rangeLabel(filters.page, total, data.page_size)}</span>
              <span className="spacer" />
              <Button size="sm" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}>‹ Prev</Button>
              <span className="small num">Page {filters.page} of {pages}</span>
              <Button size="sm" disabled={filters.page >= pages} onClick={() => update({ page: filters.page + 1 })}>Next ›</Button>
            </nav>
          )}
        </>
      )}

      <DropOverlay onFiles={addFiles} />
      {dialog === "upload" && <UploadDialog onFiles={addFiles} onClose={() => setDialog(null)} />}
      {dialog === "record" && <RecordDialog projectId={projectId} onStarted={() => { reloadLoud(); reloadCameras(); }} onClose={() => setDialog(null)} />}
      {camDialog && <CameraDialog projectId={projectId} camera={camDialog.camera} onSaved={() => { reloadCameras(); reload(); }} onClose={() => setCamDialog(null)} />}
      {camPreview && (
        <Modal title={`Preview: ${camPreview.name}`} onClose={() => setCamPreview(null)} wide>
          <CameraPreview autoStart fetcher={(signal) => cameraPreview(camPreview.id, signal)} />
        </Modal>
      )}
      {camDel && (
        <ConfirmDialog title="Delete camera?" danger confirmLabel="Delete camera"
          message={`“${camDel.name}” and its saved link will be removed. Recordings already made are kept.`}
          onCancel={() => setCamDel(null)}
          onConfirm={() => { const c = camDel; setCamDel(null); api.deleteCamera(c.id).then(() => { toast.success("Camera deleted"); reloadCameras(); reload(); }).catch(toast.error); }} />
      )}
      {del && (
        <ConfirmDialog title="Delete video?" danger confirmLabel="Delete" message={deleteWarning(del)}
          onCancel={() => setDel(null)}
          onConfirm={() => { const v = del; setDel(null); api.deleteVideo(v.id).then(() => { toast.success("Video deleted"); reload(); }).catch(toast.error); }} />
      )}
      {rmFile && (
        <ConfirmDialog title="Delete video file?" danger confirmLabel="Delete video file" message={removeFileWarning(rmFile, fmtBytes)}
          onCancel={() => setRmFile(null)}
          onConfirm={() => { const v = rmFile; setRmFile(null); api.removeVideoFile(v.id).then((r) => { toast.success(`Video file deleted. Freed ${fmtBytes(r.freed_bytes)}. Counts and details are kept.`); reload(); }).catch(toast.error); }} />
      )}
      {conv && (
        <ConfirmDialog title="Convert to H.264?" confirmLabel="Convert"
          message={`“${conv.name}” will be converted to H.264 (up to 1280 px wide) so it plays in any browser. It waits for its turn, and until it is done the video cannot be opened. The original file is kept, and if the conversion fails the video stays as it is.`}
          onCancel={() => setConv(null)}
          onConfirm={() => { const v = conv; setConv(null); api.convertVideo(v.id).then(() => { toast.info("Converting to H.264…"); reload(); }).catch(toast.error); }} />
      )}
      {stopping && (() => { const d = stopDialog(stopping.attempting); return (
        <ConfirmDialog title={d.title} confirmLabel={d.confirm} message={d.message}
          onCancel={() => setStopping(null)}
          onConfirm={() => { const v = stopping; setStopping(null); api.stopRecording(v.id).then((r) => { toast.info(stopMessage(r)); reload(); reloadCameras(); }).catch(toast.error); }} />
      ); })()}
      {exp && <ExportDialog videoId={exp.id} videoName={exp.name} onClose={() => setExp(null)} />}
    </div>
  );
}
