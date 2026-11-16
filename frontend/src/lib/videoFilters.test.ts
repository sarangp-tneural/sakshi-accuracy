import { describe, expect, it } from "vitest";
import { checkFile } from "./uploadCheck";
import {
  DEFAULT_FILTERS, addedRange, clearFilters, deriveProgress, hasActiveFilters, lastPage, parseFilters,
  rangeLabel, serializeFilters, toApiQuery, withFilter, type Filters,
} from "./videoFilters";

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));
const f = (patch: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...patch });

describe("URL <-> filters", () => {
  it("an empty URL is the defaults", () => expect(parse("")).toEqual(DEFAULT_FILTERS));
  it("defaults serialize to nothing", () => expect(serializeFilters(DEFAULT_FILTERS).toString()).toBe(""));
  it("round trips every field", () => {
    const full = f({ q: "cam 1", status: ["ready", "failed"], source: "rtsp", progress: "counting", added: "7d", sort: "duration", page: 3 });
    expect(parseFilters(serializeFilters(full))).toEqual(full);
    const custom = f({ added: "custom", from: "2026-11-01", to: "2026-11-09", sort: "name" });
    expect(parseFilters(serializeFilters(custom))).toEqual(custom);
    const today = f({ added: "today", status: ["recording"] });
    expect(parseFilters(serializeFilters(today))).toEqual(today);
  });
  it("status is repeatable, canonical and de-duplicated", () => {
    expect(parse("status=failed&status=ready&status=ready").status).toEqual(["ready", "failed"]);
    expect(serializeFilters(f({ status: ["failed", "ready"] })).getAll("status")).toEqual(["ready", "failed"]);
  });
  it("'connecting' (Attempting) is a valid status that round-trips and keeps its place in the order", () => {
    const f1 = f({ status: ["failed", "connecting", "ready"] });
    expect(serializeFilters(f1).getAll("status")).toEqual(["ready", "connecting", "failed"]);
    expect(parse("status=connecting&status=recording").status).toEqual(["connecting", "recording"]);
    expect(parseFilters(serializeFilters(f1)).status).toEqual(["ready", "connecting", "failed"]);
    expect(toApiQuery(f({ status: ["connecting"] })).getAll("status")).toEqual(["connecting"]);
  });
  it("invalid values fall back to defaults and never throw", () => {
    const p = parse("status=weird&source=ftp&progress=done&sort=difference&page=0&added=yesterday&from=nope&to=2026-02-31");
    expect(p).toEqual(DEFAULT_FILTERS);
    expect(parse("page=abc").page).toBe(1);
    expect(parse("page=-4").page).toBe(1);
    expect(parse("q=" + "x".repeat(300)).q).toHaveLength(100);
  });
  it("a real date is kept, a custom range overrides 'added'", () => {
    const p = parse("added=today&from=2026-11-01");
    expect(p).toMatchObject({ added: "custom", from: "2026-11-01", to: "" });
    expect(serializeFilters(p).toString()).toBe("from=2026-11-01");
  });
  it("choosing a custom range before picking dates survives the URL (so the date inputs stay visible)", () => {
    const chosen = f({ added: "custom" });
    expect(serializeFilters(chosen).toString()).toBe("added=custom");
    expect(parse("added=custom")).toEqual(chosen);
    expect(hasActiveFilters(chosen)).toBe(false); // nothing is narrowed yet
    expect(addedRange(chosen, new Date(2026, 10, 10))).toEqual({});
    expect(hasActiveFilters(f({ added: "custom", from: "2026-11-01" }))).toBe(true);
  });
  it("a leap day is valid, a non-leap one is not", () => {
    expect(parse("from=2028-02-29").from).toBe("2028-02-29");
    expect(parse("from=2026-02-29").from).toBe("");
  });
  it("whitespace-only search is not a filter", () => {
    expect(serializeFilters(f({ q: "   " })).toString()).toBe("");
    expect(hasActiveFilters(f({ q: "   " }))).toBe(false);
  });
});

describe("filter rules", () => {
  it("changing a filter goes back to page 1, changing the page does not", () => {
    const at3 = f({ page: 3, source: "rtsp" });
    expect(withFilter(at3, { q: "x" }).page).toBe(1);
    expect(withFilter(at3, { sort: "name" }).page).toBe(1);
    expect(withFilter(at3, { page: 4 }).page).toBe(4);
  });
  it("hasActiveFilters ignores sort and page", () => {
    expect(hasActiveFilters(f({ sort: "name", page: 4 }))).toBe(false);
    for (const p of [{ q: "a" }, { status: ["ready"] as Filters["status"] }, { source: "upload" as const }, { progress: "compared" as const }, { added: "today" as const }]) expect(hasActiveFilters(f(p))).toBe(true);
  });
  it("clearFilters keeps the sort", () => expect(clearFilters(f({ q: "a", source: "rtsp", sort: "duration", page: 2 }))).toEqual(f({ sort: "duration" })));
});

describe("deriveProgress", () => {
  it("not started, counting, compared", () => {
    expect(deriveProgress({ mark_total: 0, sakshi_entered: false })).toBe("not_started");
    expect(deriveProgress({ mark_total: 4, sakshi_entered: false })).toBe("counting");
    expect(deriveProgress({ mark_total: 4, sakshi_entered: true })).toBe("compared");
  });
  it("a Sakshi result with no manual marks still counts as compared", () => expect(deriveProgress({ mark_total: 0, sakshi_entered: true })).toBe("compared"));
});

describe("date ranges", () => {
  const now = new Date(2026, 10, 10, 15, 30); // 10 Nov 2026, local
  const local = (iso?: string) => (iso ? new Date(iso) : null);
  it("today starts at local midnight and has no end", () => {
    const r = addedRange({ added: "today", from: "", to: "" }, now);
    expect(local(r.from)).toEqual(new Date(2026, 10, 10, 0, 0, 0, 0));
    expect(r.to).toBeUndefined();
  });
  it("last 7 days covers today and the 6 days before", () => {
    expect(local(addedRange({ added: "7d", from: "", to: "" }, now).from)).toEqual(new Date(2026, 10, 4, 0, 0, 0, 0));
  });
  it("a custom range runs from the first day's start to the last day's end; a swapped range is fixed", () => {
    const r = addedRange({ added: "custom", from: "2026-11-01", to: "2026-11-03" }, now);
    expect(local(r.from)).toEqual(new Date(2026, 10, 1, 0, 0, 0, 0));
    expect(local(r.to)).toEqual(new Date(2026, 10, 3, 23, 59, 59, 999));
    const swapped = addedRange({ added: "custom", from: "2026-11-09", to: "2026-11-02" }, now);
    expect(local(swapped.from)).toEqual(new Date(2026, 10, 2, 0, 0, 0, 0));
    expect(local(swapped.to)).toEqual(new Date(2026, 10, 9, 23, 59, 59, 999));
    expect(addedRange({ added: "custom", from: "2026-11-05", to: "" }, now).to).toBeUndefined();
  });
  it("no range for 'any'", () => expect(addedRange({ added: "any", from: "", to: "" }, now)).toEqual({}));
});

describe("API query", () => {
  it("always sends sort, page and page_size; sends only the filters that are set", () => {
    const q = toApiQuery(DEFAULT_FILTERS);
    expect(q.toString()).toBe("sort=newest&page=1&page_size=25");
    const q2 = toApiQuery(f({ q: " cam ", status: ["ready", "partial"], source: "rtsp", progress: "compared", sort: "name", page: 2 }), new Date(2026, 10, 10));
    expect(q2.get("q")).toBe("cam");
    expect(q2.getAll("status")).toEqual(["ready", "partial"]);
    expect([q2.get("source"), q2.get("progress"), q2.get("sort"), q2.get("page")]).toEqual(["rtsp", "compared", "name", "2"]);
  });
  it("includes the date bounds", () => {
    const q = toApiQuery(f({ added: "custom", from: "2026-11-01", to: "2026-11-03" }));
    expect(q.get("added_from")).toBeTruthy();
    expect(new Date(q.get("added_to")!).getTime()).toBeGreaterThan(new Date(q.get("added_from")!).getTime());
  });
});

describe("paging labels", () => {
  it("lastPage", () => { expect(lastPage(0)).toBe(1); expect(lastPage(25)).toBe(1); expect(lastPage(26)).toBe(2); expect(lastPage(134)).toBe(6); });
  it("rangeLabel", () => {
    expect(rangeLabel(1, 0)).toBe("0 results");
    expect(rangeLabel(1, 134)).toBe("1–25 of 134");
    expect(rangeLabel(6, 134)).toBe("126–134 of 134");
    expect(rangeLabel(1, 3)).toBe("1–3 of 3");
  });
});

describe("upload check", () => {
  it("accepts mp4/avi/mov in any case, rejects the rest", () => {
    expect(checkFile({ name: "a.MP4", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.avi", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.mov", size: 10 })).toBeNull();
    expect(checkFile({ name: "a.mkv", size: 10 })).toMatch(/not supported/);
    expect(checkFile({ name: "noext", size: 10 })).toMatch(/not supported/);
    expect(checkFile({ name: "a.mp4", size: 0 })).toMatch(/empty/);
    expect(checkFile({ name: "a.mp4", size: 5 * 1024 ** 3 })).toMatch(/4 GB/);
  });
});

describe("size sort", () => {
  it("round-trips through the URL", () => {
    const p = parseFilters(new URLSearchParams("sort=size"));
    expect(p.sort).toBe("size");
    expect(serializeFilters(p).get("sort")).toBe("size");
  });
});
