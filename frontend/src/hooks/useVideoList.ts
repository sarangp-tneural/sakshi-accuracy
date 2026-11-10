import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type VideoList } from "../api";
import { clearFilters, lastPage, parseFilters, serializeFilters, toApiQuery, withFilter, type Filters } from "../lib/videoFilters";

const POLL_MS = 3000;

/** The Videos table's data: filters live in the URL, results come from the server, polling only while something is recording/processing. */
export function useVideoList(projectId: number) {
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => parseFilters(sp), [sp]);
  const [data, setData] = useState<VideoList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const req = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback((quiet = false) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const id = ++req.current;
    if (!quiet) setLoading(true);
    api.videos(projectId, toApiQuery(filters), ac.signal)
      .then((d) => { if (id === req.current) { setData(d); setError(""); setLoading(false); } })
      .catch((e: Error) => { if (ac.signal.aborted || id !== req.current) return; setError(e.message); setLoading(false); });
  }, [projectId, filters]);

  useEffect(() => { load(); return () => abort.current?.abort(); }, [load]);

  // poll only while a recording/processing video exists in the project (the server says so, whatever the filters)
  const busy = data?.busy ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  // Build every change on the URL as it is *now*, not on the last render, so two quick changes (From then To) both stick.
  const current = () => parseFilters(new URLSearchParams(window.location.search));
  const update = useCallback((patch: Partial<Filters>, replace = false) => {
    setSp(serializeFilters(withFilter(current(), patch)), { replace });
  }, [setSp]);
  const clear = useCallback(() => setSp(serializeFilters(clearFilters(current()))), [setSp]);

  // after deleting the last video of a page, step back to the last page that still has rows
  useEffect(() => {
    if (data && data.items.length === 0 && data.total > 0 && filters.page > 1) update({ page: lastPage(data.total, data.page_size) }, true);
  }, [data, filters.page, update]);

  return { filters, update, clear, data, loading, error, reload: () => load(true), reloadLoud: () => load(false) };
}
