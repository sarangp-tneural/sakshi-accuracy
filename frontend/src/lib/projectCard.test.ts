import { describe, expect, it } from "vitest";
import type { Project } from "../api";
import { comparedPct, fmtAgo, fmtTotalDuration, projectSummary, stateBadges } from "./projectCard";

const NOW = new Date("2026-11-10T12:00:00Z").getTime();
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

describe("fmtAgo", () => {
  it("reads naturally at each scale", () => {
    expect(fmtAgo(ago(5), NOW)).toBe("just now");
    expect(fmtAgo(ago(44), NOW)).toBe("just now");
    expect(fmtAgo(ago(60), NOW)).toBe("1 min ago");
    expect(fmtAgo(ago(25 * 60), NOW)).toBe("25 min ago");
    expect(fmtAgo(ago(2 * 3600), NOW)).toBe("2 h ago");
    expect(fmtAgo(ago(30 * 3600), NOW)).toBe("yesterday");
    expect(fmtAgo(ago(3 * 86400), NOW)).toBe("3 days ago");
  });
  it("shows the date after a month", () => expect(fmtAgo(ago(60 * 86400), NOW)).toMatch(/2026/));
  it("never goes negative, and handles missing or invalid values", () => {
    expect(fmtAgo(new Date(NOW + 5 * 60_000).toISOString(), NOW)).toBe("just now");
    expect(fmtAgo(null, NOW)).toBe("—");
    expect(fmtAgo("nope", NOW)).toBe("—");
  });
});

describe("fmtTotalDuration", () => {
  it("formats", () => {
    expect(fmtTotalDuration(0)).toBe("—");
    expect(fmtTotalDuration(-5)).toBe("—");
    expect(fmtTotalDuration(20)).toBe("<1 min");
    expect(fmtTotalDuration(47 * 60)).toBe("47 min");
    expect(fmtTotalDuration(3600)).toBe("1 h");
    expect(fmtTotalDuration(3600 + 32 * 60)).toBe("1 h 32 min");
    expect(fmtTotalDuration(3600 + 5 * 60)).toBe("1 h 05 min");
    expect(fmtTotalDuration(26 * 3600)).toBe("26 h");
  });
});

describe("comparedPct", () => {
  it("is a whole percent, 0 for no videos, capped at 100", () => {
    expect(comparedPct(0, 0)).toBe(0);
    expect(comparedPct(9, 24)).toBe(38);
    expect(comparedPct(24, 24)).toBe(100);
    expect(comparedPct(30, 24)).toBe(100);
  });
});

describe("stateBadges", () => {
  it("lists only what needs attention, most important first", () => {
    expect(stateBadges({ recording_count: 0, processing_count: 0, failed_count: 0 })).toEqual([]);
    expect(stateBadges({ recording_count: 1, processing_count: 2, failed_count: 3 }).map((b) => b.key)).toEqual(["recording", "processing", "failed"]);
    expect(stateBadges({ recording_count: 0, processing_count: 0, failed_count: 2 })).toEqual([{ key: "failed", label: "Failed", n: 2 }]);
  });
});

describe("projectSummary", () => {
  const p = { video_count: 1, camera_count: 2, mark_total: 1, compared_count: 0 } as Project;
  it("pluralises", () => expect(projectSummary(p)).toBe("1 video, 2 cameras, 1 mark, 0 of 1 compared with Sakshi"));
});
