import type { Bindings } from "./keys/registry";

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

export interface Project { id: number; name: string }
export interface Video {
  id: number; project_id: number; name: string; source: "upload" | "rtsp";
  status: "processing" | "ready" | "recording" | "partial" | "failed";
  status_reason: string | null; duration_s: number | null; fps: number | null;
  rtsp_url_masked: string | null; rtsp_minutes: number | null; created_at: string;
  started_at: string | null; ended_at: string | null; file_size: number | null;
  width: number | null; height: number | null; vcodec: string | null;
  mark_total: number; mark_in: number; mark_out: number; mark_male: number; mark_female: number; mark_unknown: number; sakshi_entered: boolean; camera_id: number | null; camera_name: string | null;
}
export interface Mark { id: number; video_id: number; time_s: number; direction: "in" | "out"; gender: "male" | "female" | "unknown"; x: number | null; y: number | null }
export type MarkFields = Pick<Mark, "time_s" | "direction" | "gender">;
export interface Camera {
  id: number; project_id: number; name: string; rtsp_url_masked: string; default_minutes: number; created_at: string;
  last_recorded_at: string | null; recording_video_id: number | null; recording_started_at: string | null; recording_minutes: number | null;
}
export interface VideoList {
  items: Video[]; total: number; page: number; page_size: number;
  status_counts: Record<"all" | "ready" | "recording" | "processing" | "partial" | "failed", number>;
  busy: boolean;
}
export interface Sakshi { in_count: number | null; out_count: number | null; male_count: number | null; female_count: number | null }
export interface UserSettings { reaction_delay_s: number; sound_enabled: boolean; slow_after_jump: boolean; key_bindings: Bindings }

export const api = {
  login: (email: string, password: string) => req<{ token: string }>("/auth/login", { method: "POST", body: body({ email, password }) }),
  projects: () => req<Project[]>("/projects"),
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
  deleteCamera: (id: number) => req<void>(`/cameras/${id}`, { method: "DELETE" }),
  recordCamera: (id: number, minutes?: number) => req<Video>(`/cameras/${id}/record`, { method: "POST", body: body(minutes === undefined ? {} : { minutes }) }),
  stopRecording: (id: number) => req<Video>(`/videos/${id}/stop`, { method: "POST" }),
  deleteVideo: (id: number) => req<void>(`/videos/${id}`, { method: "DELETE" }),
  marks: (vid: number) => req<Mark[]>(`/videos/${vid}/marks`),
  addMark: (vid: number, m: MarkFields) => req<Mark>(`/videos/${vid}/marks`, { method: "POST", body: body(m) }),
  patchMark: (id: number, m: Partial<MarkFields>) => req<Mark>(`/marks/${id}`, { method: "PATCH", body: body(m) }),
  setPoint: (id: number, x: number, y: number) => req<Mark>(`/marks/${id}/point`, { method: "PUT", body: body({ x, y }) }),
  clearPoint: (id: number) => req<Mark>(`/marks/${id}/point`, { method: "DELETE" }),
  deleteMark: (id: number) => req<void>(`/marks/${id}`, { method: "DELETE" }),
  undo: (vid: number) => req<Mark>(`/videos/${vid}/marks/last`, { method: "DELETE" }),
  sakshi: (vid: number) => req<Sakshi>(`/videos/${vid}/sakshi`),
  putSakshi: (vid: number, s: Sakshi) => req<Sakshi>(`/videos/${vid}/sakshi`, { method: "PUT", body: body(s) }),
  comparison: (vid: number) => req<Record<string, import("./lib/format").Metric>>(`/videos/${vid}/comparison`),
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
