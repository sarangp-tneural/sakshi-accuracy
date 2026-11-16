import { describe, expect, it } from "vitest";
import type { DashVideo, EvalMetrics } from "../api";
import { countOffPct, linePaths, matchVideo, niceMax, sortVideos } from "./dashboard";

const M = (o: Partial<EvalMetrics> = {}): EvalMetrics => ({ actual: 0, system: null, tp: null, fp: null, fn: null, over_under: null, precision: null, recall: null, gender_accuracy: null, male_accuracy: null, female_accuracy: null, gender_coverage: null, ...o });
const V = (name: string, actual: number, system: number | null, precision: number | null, project = "p", camera: string | null = null): DashVideo => ({
  id: 1, name, status: "ready", source: "upload", created_at: "2026-11-10T00:00:00Z", project_id: 1, project, camera_id: null, camera,
  marks: actual, sakshi_entered: system !== null, tp_source: "manual", actual, system, tp: null, metrics: M({ precision }), problems: [],
});

describe("dashboard helpers", () => {
  it("count off is a share of your count, undefined without both numbers", () => {
    expect(countOffPct(34, 55)).toBe(61.8);
    expect(countOffPct(100, 80)).toBe(-20);
    expect(countOffPct(0, 5)).toBeNull();
    expect(countOffPct(10, null)).toBeNull();
  });
  it("sorts both ways and always puts missing values last", () => {
    const rows = [V("b", 5, 5, 50), V("a", 5, 5, null), V("c", 5, 5, 90)];
    expect(sortVideos(rows, "precision", "desc").map((r) => r.name)).toEqual(["c", "b", "a"]);
    expect(sortVideos(rows, "precision", "asc").map((r) => r.name)).toEqual(["b", "c", "a"]);
    expect(sortVideos(rows, "name", "asc").map((r) => r.name)).toEqual(["a", "b", "c"]);
  });
  it("sorting by count-off uses the size of the gap, over or under", () => {
    const rows = [V("under", 100, 70, null), V("over", 100, 110, null), V("none", 100, null, null)];
    expect(sortVideos(rows, "off", "desc").map((r) => r.name)).toEqual(["under", "over", "none"]);
  });
  it("searches name, project and camera", () => {
    const r = V("Borivali.mp4", 1, 1, 1, "Mira Road", "Door");
    expect(matchVideo(r, "")).toBe(true);
    expect(matchVideo(r, "bori")).toBe(true);
    expect(matchVideo(r, "mira")).toBe(true);
    expect(matchVideo(r, "door")).toBe(true);
    expect(matchVideo(V("x", 1, 1, 1), "no camera")).toBe(true);
    expect(matchVideo(r, "zzz")).toBe(false);
  });
  it("nice axis maximum", () => {
    expect([0, 1, 7, 130, 4200, 0.3].map(niceMax)).toEqual([1, 1, 10, 200, 5000, 0.5]);
  });
  it("line paths break at gaps and clamp to the axis", () => {
    const runs = linePaths([100, null, 50, 150], 100, 100);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toEqual(["0.0,0.0"]);
    expect(runs[1]).toEqual(["66.7,50.0", "100.0,0.0"]); // 150 is clamped to the top
    expect(linePaths([40], 100, 100)).toEqual([["50.0,60.0"]]);
    expect(linePaths([], 100, 100)).toEqual([]);
  });
});
