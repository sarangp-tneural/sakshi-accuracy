import { useCallback, useEffect, useRef, useState } from "react";
import { uploadWithProgress } from "../api";
import { checkFile } from "../lib/uploadCheck";

export interface UploadItem { id: number; name: string; size: number; pct: number; state: "queued" | "uploading" | "error"; error?: string }

/** Uploads one file after another. Progress rows live in the list, nothing blocks the page. */
export function useUploads(projectId: number, onUploaded: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const store = useRef<UploadItem[]>([]);
  const files = useRef(new Map<number, File>());
  const cancels = useRef(new Map<number, () => void>());
  const running = useRef(false);
  const alive = useRef(true);
  const nextId = useRef(0);
  const done = useRef(onUploaded);
  done.current = onUploaded;
  const emit = () => { if (alive.current) setItems([...store.current]); };
  const remove = (id: number) => { store.current = store.current.filter((i) => i.id !== id); files.current.delete(id); emit(); };

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = store.current.find((i) => i.state === "queued");
        if (!next || !alive.current) break;
        next.state = "uploading"; next.pct = 0; emit();
        const up = uploadWithProgress(projectId, files.current.get(next.id)!, (p) => { next.pct = p; emit(); });
        cancels.current.set(next.id, up.cancel);
        try {
          await up.promise;
          remove(next.id);
          done.current();
        } catch (e) {
          const msg = (e as Error).message;
          if (msg === "Upload cancelled") remove(next.id);
          else { next.state = "error"; next.error = msg; emit(); }
        }
        cancels.current.delete(next.id);
      }
    } finally { running.current = false; }
  }, [projectId]);

  /** Queue files. Returns the messages for files that were rejected (wrong type, empty, too big). */
  const add = useCallback((list: File[]): string[] => {
    const rejected: string[] = [];
    for (const f of list) {
      const bad = checkFile(f);
      if (bad) { rejected.push(bad); continue; }
      const id = ++nextId.current;
      files.current.set(id, f);
      store.current.push({ id, name: f.name, size: f.size, pct: 0, state: "queued" });
    }
    emit();
    void pump();
    return rejected;
  }, [pump]);

  const cancel = useCallback((id: number) => {
    const c = cancels.current.get(id);
    if (c) c(); else remove(id); // uploading -> abort (removed when it settles); queued or failed -> just drop it
  }, []);

  useEffect(() => {
    alive.current = true;
    const active = cancels.current;
    return () => { alive.current = false; active.forEach((c) => c()); };
  }, []);

  return { items, add, cancel };
}
