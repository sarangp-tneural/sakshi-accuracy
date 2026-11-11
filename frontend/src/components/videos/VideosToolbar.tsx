import { useEffect, useRef, useState } from "react";
import { PROGRESSES, SORTS, hasActiveFilters, type Added, type Filters, type Progress, type Sort } from "../../lib/videoFilters";
import { Button } from "../ui/bits";

const PROGRESS_LABEL: Record<Progress, string> = { not_started: "Not started (no marks)", counting: "Counting (marks, no Sakshi)", compared: "Compared (Sakshi entered)" };
const SORT_LABEL: Record<Sort, string> = { newest: "Newest first", oldest: "Oldest first", name: "Name (A–Z)", duration: "Longest first", size: "Largest file" };
const DEBOUNCE_MS = 300;

interface Props {
  filters: Filters;
  update: (patch: Partial<Filters>, replace?: boolean) => void;
  clear: () => void;
}

export default function VideosToolbar({ filters, update, clear }: Props) {
  // typing is local and debounced into the URL; an outside change of q (Clear filters, back button) flows back in
  const [text, setText] = useState(filters.q);
  const lastSent = useRef(filters.q);
  useEffect(() => { if (filters.q !== lastSent.current) { lastSent.current = filters.q; setText(filters.q); } }, [filters.q]);
  useEffect(() => {
    if (text === lastSent.current) return;
    const t = setTimeout(() => { lastSent.current = text; update({ q: text }, true); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, update]);

  const active = hasActiveFilters(filters);
  const setAdded = (added: Added) => update({ added, from: "", to: "" });

  return (
    <div className="vtoolbar">
      <div className="field search">
        <label htmlFor="v-search">Search</label>
        <input id="v-search" type="search" placeholder="Search videos by name" value={text} maxLength={100} autoComplete="off" onChange={(e) => setText(e.target.value)} />
      </div>
      <div className="field">
        <span className="label" id="v-source-l">Source</span>
        <div className="seg" role="group" aria-labelledby="v-source-l">
          {([["", "All"], ["upload", "Upload"], ["rtsp", "RTSP"]] as const).map(([v, label]) => (
            <button key={v || "all"} type="button" aria-pressed={filters.source === v} onClick={() => update({ source: v })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="v-progress">Progress</label>
        <select id="v-progress" value={filters.progress} onChange={(e) => update({ progress: e.target.value as Filters["progress"] })}>
          <option value="">All</option>
          {PROGRESSES.map((p) => <option key={p} value={p}>{PROGRESS_LABEL[p]}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="v-added">Added</label>
        <select id="v-added" value={filters.added} onChange={(e) => setAdded(e.target.value as Added)}>
          <option value="any">Any time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="custom">Custom range…</option>
        </select>
      </div>
      {filters.added === "custom" && (
        <>
          <div className="field"><label htmlFor="v-from">From</label><input id="v-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} /></div>
          <div className="field"><label htmlFor="v-to">To</label><input id="v-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} /></div>
        </>
      )}
      <div className="field">
        <label htmlFor="v-sort">Sort</label>
        <select id="v-sort" value={filters.sort} onChange={(e) => update({ sort: e.target.value as Sort })}>
          {SORTS.map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
        </select>
      </div>
      {active && <Button variant="ghost" size="sm" className="clearbtn" onClick={clear}>Clear filters</Button>}
    </div>
  );
}
