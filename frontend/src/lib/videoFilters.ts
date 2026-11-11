/** Search / filter / sort / page state of the project Videos table. The URL is the source of truth. */
export const STATUSES = ["ready", "connecting", "recording", "processing", "partial", "failed"] as const;
export type StatusKey = (typeof STATUSES)[number];
export const PROGRESSES = ["not_started", "counting", "compared"] as const;
export type Progress = (typeof PROGRESSES)[number];
export const SORTS = ["newest", "oldest", "name", "duration", "size"] as const;
export type Sort = (typeof SORTS)[number];
export type Added = "any" | "today" | "7d" | "custom";
export type Source = "" | "upload" | "rtsp";

export interface Filters {
  q: string;
  status: StatusKey[];
  source: Source;
  progress: "" | Progress;
  added: Added;
  from: string; // YYYY-MM-DD, only for added === "custom"
  to: string;
  sort: Sort;
  page: number;
}

export const DEFAULT_FILTERS: Filters = { q: "", status: [], source: "", progress: "", added: "any", from: "", to: "", sort: "newest", page: 1 };
export const PAGE_SIZE = 25;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** "2026-11-10" if it is a real calendar date, otherwise "" (so 2026-02-31 is rejected). */
const validDate = (s: string | null): string => {
  if (!s || !DATE_RE.test(s)) return "";
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? s : "";
};

/** Read filters from a query string. Anything invalid falls back to the default; nothing throws. */
export function parseFilters(sp: URLSearchParams): Filters {
  const status = STATUSES.filter((s) => sp.getAll("status").includes(s)); // canonical order, no duplicates, no unknowns
  const source = sp.get("source");
  const progress = sp.get("progress");
  const sort = sp.get("sort");
  const from = validDate(sp.get("from"));
  const to = validDate(sp.get("to"));
  const addedParam = sp.get("added");
  // dates imply a custom range; "added=custom" on its own means "custom range chosen, dates not picked yet"
  const added: Added = from || to || addedParam === "custom" ? "custom" : addedParam === "today" || addedParam === "7d" ? addedParam : "any";
  const page = Number.parseInt(sp.get("page") ?? "", 10);
  return {
    q: (sp.get("q") ?? "").slice(0, 100),
    status,
    source: source === "upload" || source === "rtsp" ? source : "",
    progress: (PROGRESSES as readonly string[]).includes(progress ?? "") ? (progress as Progress) : "",
    added,
    from: added === "custom" ? from : "",
    to: added === "custom" ? to : "",
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "newest",
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** Write filters to a query string, leaving out everything that is at its default. */
export function serializeFilters(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  for (const s of STATUSES) if (f.status.includes(s)) sp.append("status", s);
  if (f.source) sp.set("source", f.source);
  if (f.progress) sp.set("progress", f.progress);
  if (f.added === "today" || f.added === "7d") sp.set("added", f.added);
  if (f.added === "custom") {
    if (f.from) sp.set("from", f.from);
    if (f.to) sp.set("to", f.to);
    if (!f.from && !f.to) sp.set("added", "custom"); // keep the choice (and the date inputs) alive until dates are picked
  }
  if (f.sort !== "newest") sp.set("sort", f.sort);
  if (f.page > 1) sp.set("page", String(f.page));
  return sp;
}

/** Apply a change. Any change other than the page itself goes back to page 1. */
export function withFilter(f: Filters, patch: Partial<Filters>): Filters {
  const next = { ...f, ...patch };
  if (!("page" in patch)) next.page = 1;
  return next;
}

/** True when something narrows the list (sort and page do not count). */
export function hasActiveFilters(f: Filters): boolean {
  const dateNarrows = f.added === "custom" ? !!(f.from || f.to) : f.added !== "any";
  return !!(f.q.trim() || f.status.length || f.source || f.progress || dateNarrows);
}

export function clearFilters(f: Filters): Filters {
  return { ...DEFAULT_FILTERS, sort: f.sort };
}

/** Where a video is in the workflow, derived from data we already have. */
export type VideoProgress = Progress;
export function deriveProgress(v: { mark_total: number; sakshi_entered: boolean }): VideoProgress {
  if (v.sakshi_entered) return "compared";
  if (v.mark_total > 0) return "counting";
  return "not_started";
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
const parseLocalDate = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/** The "added" filter as ISO instants (local midnight boundaries), for added_from / added_to. */
export function addedRange(f: Pick<Filters, "added" | "from" | "to">, now: Date = new Date()): { from?: string; to?: string } {
  if (f.added === "today") return { from: startOfDay(now).toISOString() };
  if (f.added === "7d") return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)).toISOString() };
  if (f.added === "custom") {
    let a = f.from ? parseLocalDate(f.from) : null;
    let b = f.to ? parseLocalDate(f.to) : null;
    if (a && b && a > b) [a, b] = [b, a];
    return { from: a ? startOfDay(a).toISOString() : undefined, to: b ? endOfDay(b).toISOString() : undefined };
  }
  return {};
}

/** The API query for these filters. */
export function toApiQuery(f: Filters, now: Date = new Date(), pageSize = PAGE_SIZE): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  for (const s of f.status) sp.append("status", s);
  if (f.source) sp.set("source", f.source);
  if (f.progress) sp.set("progress", f.progress);
  const r = addedRange(f, now);
  if (r.from) sp.set("added_from", r.from);
  if (r.to) sp.set("added_to", r.to);
  sp.set("sort", f.sort);
  sp.set("page", String(f.page));
  sp.set("page_size", String(pageSize));
  return sp;
}

export function lastPage(total: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** "1–25 of 134", or "0 results". */
export function rangeLabel(page: number, total: number, pageSize = PAGE_SIZE): string {
  if (total === 0) return "0 results";
  const from = (page - 1) * pageSize + 1;
  return `${Math.min(from, total)}–${Math.min(page * pageSize, total)} of ${total}`;
}

/** Gender totals for a row, always all three (zeros kept). */
export function genderParts(v: { mark_male: number; mark_female: number; mark_unknown: number }) {
  return [
    { key: "male" as const, letter: "M", n: v.mark_male },
    { key: "female" as const, letter: "F", n: v.mark_female },
    { key: "unknown" as const, letter: "?", n: v.mark_unknown },
  ];
}
export const genderText = (v: { mark_male: number; mark_female: number; mark_unknown: number }) =>
  genderParts(v).map((p) => `${p.letter} ${p.n}`).join(" · ");
