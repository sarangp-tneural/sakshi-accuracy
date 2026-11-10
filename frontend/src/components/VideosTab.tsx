import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Video } from "../api";
import { useUploads } from "../hooks/useUploads";
import { useVideoList } from "../hooks/useVideoList";
import { lastPage, hasActiveFilters, rangeLabel, type StatusKey } from "../lib/videoFilters";
import { deleteWarning } from "../lib/videoRow";
import ExportDialog from "./ExportDialog";
import ProjectHeader from "./ProjectHeader";
import { Button, EmptyState, LoadError, Spinner } from "./ui/bits";
import { ConfirmDialog } from "./ui/Modal";
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
  const [exp, setExp] = useState<Video | null>(null);
  const [stopping, setStopping] = useState<Video | null>(null);
  const [now, setNow] = useState(Date.now());

  const uploads = useUploads(projectId, useCallback(() => { toast.success("Upload complete. Preparing the video…"); reload(); }, [toast, reload]));

  // elapsed time of a live recording ticks locally; the server is only polled while something is busy
  const anyRecording = data?.items.some((v) => v.status === "recording") ?? false;
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
              onCancelUpload={uploads.cancel} onOpen={(v) => nav(`/videos/${v.id}`)} onStop={setStopping} onExport={setExp} onDelete={setDel} />
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
      {dialog === "record" && <RecordDialog projectId={projectId} onStarted={reloadLoud} onClose={() => setDialog(null)} />}
      {del && (
        <ConfirmDialog title="Delete video?" danger confirmLabel="Delete" message={deleteWarning(del)}
          onCancel={() => setDel(null)}
          onConfirm={() => { const v = del; setDel(null); api.deleteVideo(v.id).then(() => { toast.success("Video deleted"); reload(); }).catch(toast.error); }} />
      )}
      {stopping && (
        <ConfirmDialog title="Stop recording?" confirmLabel="Stop and keep video"
          message="Recording stops now and the part recorded so far is saved as a video you can count."
          onCancel={() => setStopping(null)}
          onConfirm={() => { const v = stopping; setStopping(null); api.stopRecording(v.id).then(() => { toast.info("Stopping… saving the video"); reload(); }).catch(toast.error); }} />
      )}
      {exp && <ExportDialog videoId={exp.id} videoName={exp.name} onClose={() => setExp(null)} />}
    </div>
  );
}
