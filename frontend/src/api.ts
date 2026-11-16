import type { Bindings } from "./keys/registry";
import type { VirtualLine } from "./lib/lines";
import type { Metric } from "./lib/format";

const TOKEN_KEY = "sv_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const t = getToken();
  if (t) headers.set("Authorization", `Bearer ${t}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const r = await fetch("/api" + path, { ...init, headers });
  if (r.status === 401 && path !== "/auth/login") {
    setToken(null);
    location.href = "/login";
  }
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* not json */ }
    throw new ApiError(r.status, msg);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const body = (b: unknown) => JSON.stringify(b);

export interface Project {
  id: number; name: string; created_at: string;
  video_count: number; recording_count: number; connecting_count: number; processing_count: number; failed_count: number; camera_count: number;
  mark_total: number; mark_in: number; mark_out: number; compared_count: number; total_duration_s: number; last_activity_at: string | null;
}
export interface Video {
  id: number; project_id: number; name: string; source: "upload" | "rtsp";
  status: "connecting" | "processing" | "ready" | "recording" | "partial" | "failed";
  status_reason: string | null; duration_s: number | null; fps: number | null;
  rtsp_url_masked: string | null; rtsp_minutes: number | null; created_at: string;
  started_at: string | null; ended_at: string | null; file_size: number | null;
  width: number | null; height: number | null; vcodec: string | null;
  mark_total: number; mark_in: number; mark_out: number; mark_types: Record<string, number>; sakshi_entered: boolean; camera_id: number | null; camera_name: string | null;
  video_removed_at?: string | null; disk_bytes?: number | null; // set once only the video FILE was deleted
  lines: VirtualLine[];
}
export interface MarkingType {
  id: number; project_id: number; label: string; direction: "in" | "out" | null; key_code: string; color: string | null;
  sort_order: number; archived: boolean; mark_count: number;
}
export type MarkingTypeFields = { label: string; direction: "in" | "out" | null; key_code: string; color: string | null };
export interface Mark { id: number; video_id: number; time_s: number; direction: "in" | "out" | null; marking_type_id: number | null; x: number | null; y: number | null }
export type MarkFields = Pick<Mark, "time_s"> & { marking_type_id: number };
export interface Camera {
  id: number; project_id: number; name: string; rtsp_url_masked: string; default_minutes: number; created_at: string;
  lines: VirtualLine[];
  last_recorded_at: string | null; recording_video_id: number | null; recording_status: "connecting" | "recording" | null; recording_note: string | null; recording_started_at: string | null; recording_created_at: string | null; recording_minutes: number | null;
}
export interface VideoList {
  items: Video[]; total: number; page: number; page_size: number;
  status_counts: Record<"all" | "ready" | "connecting" | "recording" | "processing" | "partial" | "failed", number>;
  busy: boolean;
}
export interface Sakshi { counts: Record<string, number>; legacy?: Record<string, number> | null }
export interface TypeMetric extends Metric { id: number; label: string; direction: "in" | "out" | null; archived: boolean }
export interface Comparison { in: Metric; out: Metric; total: Metric; types: TypeMetric[] }
export interface EvalScalars {
  tp: number | null; gender_assigned: number | null; real_male_in_tp: number | null; real_female_in_tp: number | null;
  correct_male: number | null; correct_female: number | null;
}
export interface EvalInputs extends EvalScalars { type_tp: Record<string, number> }
export interface MarkingEval { id: number; label: string; direction: "in" | "out" | null; archived: boolean; metrics: MarkingMetrics }
export interface MarkingMetrics { actual: number; system: number | null; tp: number | null; fp: number | null; fn: number | null; over_under: number | null; precision: number | null; recall: number | null }
export interface EvalMetrics {
  actual: number; system: number | null; tp: number | null; fp: number | null; fn: number | null; over_under: number | null;
  precision: number | null; recall: number | null; gender_accuracy: number | null; male_accuracy: number | null;
  female_accuracy: number | null; gender_coverage: number | null;
}
export interface Evaluation { inputs: EvalInputs; tp_source: "manual" | "matched"; metrics: EvalMetrics; types: MarkingEval[]; problems: string[] }
export interface ProjectEvaluation {
  videos: { id: number; name: string; created_at: string; tp_source: string; metrics: EvalMetrics }[];
  total: EvalMetrics & { videos: number };
  types: { id: number; label: string; direction: "in" | "out" | null; archived: boolean; metrics: MarkingMetrics & { videos: number } }[];
}
export interface DashVideo {
  id: number; name: string; status: Video["status"]; source: string; created_at: string;
  project_id: number; project: string; camera_id: number | null; camera: string | null;
  marks: number; sakshi_entered: boolean; tp_source: string; actual: number; system: number | null; tp: number | null;
  metrics: EvalMetrics; problems: string[];
}
export type RolledMetrics = EvalMetrics & { videos: number };
export interface DashGroup { id: number; label: string; videos: number; with_tp: number; metrics: RolledMetrics }
export interface DashMarking { label: string; direction: "in" | "out" | null; marked: number; metrics: MarkingMetrics & { videos: number } }
export interface Finding { severity: "bad" | "warn" | "info"; text: string; link: string }
export interface DashTrend { date: string; videos: number; with_tp: number; actual: number; system: number; precision: number | null; recall: number | null }
export interface Dashboard {
  filters: { project_id: number | null; days: number; group: "project" | "camera" };
  projects: { id: number; name: string }[];
  cards: { added: number; marked: number; sakshi: number; tp: number; metrics: RolledMetrics; count_off_pct: number | null; actual_total: number; system_total: number };
  findings: Finding[]; groups: DashGroup[]; markings: DashMarking[]; trend: DashTrend[];
  activity: { marks_per_day: { date: string; marks: number }[]; videos_per_day: { date: string; videos: number }[]; funnel: { added: number; marked: number; sakshi: number; tp: number } };
  status_counts: Record<string, number>; videos: DashVideo[]; truncated: boolean;
}
export interface ServiceState { state: "up" | "down" | "off" | "warn"; note?: string | null; free_bytes?: number; min_free_bytes?: number; videos_bytes?: number }
export interface Health {
  recordings: { active: number; processing: number; failed_7d: number; stuck: { id: number; name: string }[]; stuck_unknown: boolean };
  cameras: { total: number; recording: number; never_recorded: number; last_failed: { id: number; name: string }[] };
  services: { disk: ServiceState; redis: ServiceState; relay: ServiceState };
  problems: { id: number; name: string; status: string; reason: string; when: string }[];
  checked_at: string;
}
export interface UserSettings { reaction_delay_s: number; sound_enabled: boolean; slow_after_jump: boolean; key_bindings: Bindings }

export const api = {
  me: () => req<{ id: number; email: string }>("/auth/me"),
  login: (email: string, password: string) => req<{ token: string }>("/auth/login", { method: "POST", body: body({ email, password }) }),
  projects: () => req<Project[]>("/projects"),
  deleteProject: (id: number) => req<void>(`/projects/${id}`, { method: "DELETE" }),
  createProject: (name: string) => req<Project>("/projects", { method: "POST", body: body({ name }) }),
  videos: (pid: number, params: URLSearchParams, signal?: AbortSignal) => req<VideoList>(`/projects/${pid}/videos?${params.toString()}`, { signal }),
  video: (id: number) => req<Video>(`/videos/${id}`),
  upload: (pid: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<Video>(`/projects/${pid}/videos/upload`, { method: "POST", body: fd });
  },
  rtsp: (pid: number, url: string, minutes: number) => req<Video>(`/projects/${pid}/videos/rtsp`, { method: "POST", body: body({ url, minutes }) }),
  cameras: (pid: number) => req<Camera[]>(`/projects/${pid}/cameras`),
  createCamera: (pid: number, c: { name: string; url: string; default_minutes: number }) => req<Camera>(`/projects/${pid}/cameras`, { method: "POST", body: body(c) }),
  updateCamera: (id: number, c: { name?: string; url?: string; default_minutes?: number }) => req<Camera>(`/cameras/${id}`, { method: "PATCH", body: body(c) }),
  putCameraLines: (id: number, lines: VirtualLine[]) => req<Camera>(`/cameras/${id}/lines`, { method: "PUT", body: body({ lines }) }),
  putVideoLines: (id: number, lines: VirtualLine[]) => req<Video>(`/videos/${id}/lines`, { method: "PUT", body: body({ lines }) }),
  deleteCamera: (id: number) => req<void>(`/cameras/${id}`, { method: "DELETE" }),
  recordCamera: (id: number, minutes?: number) => req<Video>(`/cameras/${id}/record`, { method: "POST", body: body(minutes === undefined ? {} : { minutes }) }),
  stopRecording: (id: number) => req<Video>(`/videos/${id}/stop`, { method: "POST" }),
  deleteVideo: (id: number) => req<void>(`/videos/${id}`, { method: "DELETE" }),
  removeVideoFile: (id: number) => req<{ video: Video; freed_bytes: number }>(`/videos/${id}/file`, { method: "DELETE" }),
  markingTypes: (pid: number) => req<MarkingType[]>(`/projects/${pid}/marking-types`),
  createMarkingType: (pid: number, t: MarkingTypeFields) => req<MarkingType>(`/projects/${pid}/marking-types`, { method: "POST", body: body(t) }),
  patchMarkingType: (id: number, t: Partial<MarkingTypeFields>) => req<MarkingType>(`/marking-types/${id}`, { method: "PATCH", body: body(t) }),
  deleteMarkingType: (id: number) => req<void>(`/marking-types/${id}`, { method: "DELETE" }),
  reorderMarkingTypes: (pid: number, ids: number[]) => req<MarkingType[]>(`/projects/${pid}/marking-types/order`, { method: "PUT", body: body({ ids }) }),
  marks: (vid: number) => req<Mark[]>(`/videos/${vid}/marks`),
  addMark: (vid: number, m: MarkFields) => req<Mark>(`/videos/${vid}/marks`, { method: "POST", body: body(m) }),
  patchMark: (id: number, m: Partial<MarkFields>) => req<Mark>(`/marks/${id}`, { method: "PATCH", body: body(m) }),
  setPoint: (id: number, x: number, y: number) => req<Mark>(`/marks/${id}/point`, { method: "PUT", body: body({ x, y }) }),
  clearPoint: (id: number) => req<Mark>(`/marks/${id}/point`, { method: "DELETE" }),
  deleteMark: (id: number) => req<void>(`/marks/${id}`, { method: "DELETE" }),
  undo: (vid: number) => req<Mark>(`/videos/${vid}/marks/last`, { method: "DELETE" }),
  sakshi: (vid: number) => req<Sakshi>(`/videos/${vid}/sakshi`),
  putSakshi: (vid: number, s: Sakshi) => req<Sakshi>(`/videos/${vid}/sakshi`, { method: "PUT", body: body(s) }),
  comparison: (vid: number) => req<Comparison>(`/videos/${vid}/comparison`),
  dashboard: (p: { project_id?: number | null; days: number; group: "project" | "camera" }, signal?: AbortSignal) =>
    req<Dashboard>(`/dashboard?days=${p.days}&group=${p.group}${p.project_id ? `&project_id=${p.project_id}` : ""}`, { signal }),
  dashboardHealth: (project_id?: number | null, signal?: AbortSignal) =>
    req<Health>(`/dashboard/health${project_id ? `?project_id=${project_id}` : ""}`, { signal }),
  evaluation: (vid: number) => req<Evaluation>(`/videos/${vid}/evaluation`),
  putEvaluation: (vid: number, e: EvalInputs) => req<Evaluation>(`/videos/${vid}/evaluation`, { method: "PUT", body: body(e) }),
  projectEvaluation: (pid: number) => req<ProjectEvaluation>(`/projects/${pid}/evaluation`),
  settings: () => req<UserSettings>("/settings"),
  putSettings: (s: UserSettings) => req<UserSettings>("/settings", { method: "PUT", body: body(s) }),
  resetSettings: (action?: string) => req<UserSettings>("/settings/reset" + (action ? `?action=${action}` : ""), { method: "POST" }),
};

/** Upload with progress (fetch cannot report upload progress). Same endpoint and payload as api.upload. */
export function uploadWithProgress(pid: number, file: File, onProgress: (pct: number) => void): { promise: Promise<Video>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Video>((resolve, reject) => {
    xhr.open("POST", `/api/projects/${pid}/videos/upload`);
    const t = getToken();
    if (t) xhr.setRequestHeader("Authorization", `Bearer ${t}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress((e.loaded / e.total) * 100); };
    xhr.onload = () => {
      let body: { detail?: unknown } | Video | null = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Video);
      else {
        const d = (body as { detail?: unknown } | null)?.detail;
        reject(new ApiError(xhr.status, typeof d === "string" ? d : xhr.statusText || "Upload failed"));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
  return { promise, cancel: () => xhr.abort() };
}

async function fetchJpeg(path: string, bodyObj: unknown, signal?: AbortSignal): Promise<string> {
  const r = await fetch(`/api${path}`, {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${getToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  if (!r.ok) {
    let msg = `Preview failed (${r.status})`;
    try { const j = await r.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* not json */ }
    throw new ApiError(r.status, msg);
  }
  return URL.createObjectURL(await r.blob());
}

/** One still frame from an RTSP link (the link goes in the body, never in a URL). Returns an object URL. */
export const rtspPreview = (pid: number, url: string, signal?: AbortSignal) => fetchJpeg(`/projects/${pid}/rtsp/preview`, { url }, signal);
/** One still frame from a saved camera. */
export const cameraPreview = (id: number, signal?: AbortSignal) => fetchJpeg(`/cameras/${id}/preview`, {}, signal);

/** Download an export through fetch so the UI can show loading and errors. */
export async function downloadExport(id: number, kind: "csv" | "xlsx"): Promise<void> {
  const r = await fetch(`/api/videos/${id}/export.${kind}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!r.ok) throw new ApiError(r.status, `Export failed (${r.status})`);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url; a.download = `video-${id}.${kind}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const streamUrl = (id: number) => `/api/videos/${id}/stream?token=${getToken()}`;
export const exportUrl = (id: number, kind: "csv" | "xlsx") => `/api/videos/${id}/export.${kind}?token=${getToken()}`;
