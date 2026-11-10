import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Camera } from "../api";

const POLL_MS = 3000;

/** The project's saved cameras. Refreshes every few seconds only while one of them is recording. */
export function useCameras(projectId: number) {
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [error, setError] = useState("");
  const req = useRef(0);

  const reload = useCallback(() => {
    const id = ++req.current;
    api.cameras(projectId)
      .then((c) => { if (id === req.current) { setCameras(c); setError(""); } })
      .catch((e: Error) => { if (id === req.current) setError(e.message); });
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);
  const recording = cameras?.some((c) => c.recording_video_id !== null) ?? false;
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(reload, POLL_MS);
    return () => clearInterval(t);
  }, [recording, reload]);

  return { cameras, error, reload };
}
