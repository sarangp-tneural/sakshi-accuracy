import { describe, expect, it } from "vitest";
import tokensCss from "../styles/tokens.css?raw";
import { fmtClock, fmtTime, recordingProgress, type Metric } from "./format";
import { SEVERITY_THRESHOLDS, severityOf } from "./severity";
import { nearestIndex } from "./nearest";
import { visibleRange } from "./virtual";
import { newestFirst, tickPercent } from "./ticks";

const M = (p: Partial<Metric>): Metric => ({ manual: 10, sakshi: 10, diff: 0, percent: 0, status: "ok", ...p });

describe("fmtTime", () => {
  it("formats mm:ss.s", () => {
    expect(fmtTime(0)).toBe("00:00.0");
    expect(fmtTime(34.24)).toBe("00:34.2");
    expect(fmtTime(125.5)).toBe("02:05.5");
  });
  it("carries on rounding instead of showing 60.0", () => {
    expect(fmtTime(59.96)).toBe("01:00.0");
    expect(fmtTime(-3)).toBe("00:00.0");
    expect(fmtTime(NaN)).toBe("00:00.0");
  });
  it("fmtClock", () => { expect(fmtClock(75)).toBe("01:15"); expect(fmtClock(3725)).toBe("1:02:05"); });
});

describe("recordingProgress", () => {
  it("clamps to total", () => {
    const start = "2026-01-01T00:00:00Z";
    const at = (s: number) => new Date(start).getTime() + s * 1000;
    expect(recordingProgress(start, 2, at(30))).toMatchObject({ elapsed: 30, total: 120, pct: 25 });
    expect(recordingProgress(start, 2, at(999)).elapsed).toBe(120);
    expect(recordingProgress(start, 2, at(-5)).elapsed).toBe(0);
  });
});

describe("severityOf", () => {
  it("uses thresholds in one constant", () => {
    expect(SEVERITY_THRESHOLDS).toEqual({ good: 5, warn: 15 });
    expect(severityOf(M({ diff: 0, percent: 0 }))).toBe("good");
    expect(severityOf(M({ diff: 1, percent: 5 }))).toBe("good");
    expect(severityOf(M({ diff: -1, percent: -5.1 }))).toBe("warn");
    expect(severityOf(M({ diff: 2, percent: 15 }))).toBe("warn");
    expect(severityOf(M({ diff: 3, percent: 15.1 }))).toBe("bad");
  });
  it("not entered has no severity, zero is judged", () => {
    expect(severityOf(M({ sakshi: null, diff: null, percent: null, status: "not_entered" }))).toBeNull();
    expect(severityOf(M({ manual: 5, sakshi: 0, diff: -5, percent: -100 }))).toBe("bad");
  });
  it("undefined percent: equal is good, different is bad", () => {
    expect(severityOf(M({ manual: 0, sakshi: 0, diff: 0, percent: null, status: "undefined" }))).toBe("good");
    expect(severityOf(M({ manual: 0, sakshi: 4, diff: 4, percent: null, status: "undefined" }))).toBe("bad");
  });
});

describe("nearestIndex", () => {
  it("handles empty", () => expect(nearestIndex([], 5)).toBe(-1));
  it("finds closest", () => {
    const t = [1, 5, 9];
    expect(nearestIndex(t, 0)).toBe(0);
    expect(nearestIndex(t, 4)).toBe(1);
    expect(nearestIndex(t, 8)).toBe(2);
    expect(nearestIndex(t, 100)).toBe(2);
  });
  it("tie goes to the earlier mark", () => expect(nearestIndex([2, 4], 3)).toBe(0));
  it("respects maxDist", () => { expect(nearestIndex([10], 0, 3)).toBe(-1); expect(nearestIndex([10], 8, 3)).toBe(0); });
});

describe("visibleRange", () => {
  it("windows with overscan and clamps", () => {
    expect(visibleRange(0, 100, 10, 1000, 2)).toEqual({ start: 0, end: 12 });
    expect(visibleRange(500, 100, 10, 1000, 2)).toEqual({ start: 48, end: 62 });
    expect(visibleRange(99999, 100, 10, 1000, 2).end).toBe(1000);
    expect(visibleRange(0, 100, 10, 0)).toEqual({ start: 0, end: 0 });
    expect(visibleRange(0, 100, 10, 3, 8)).toEqual({ start: 0, end: 3 });
  });
});

describe("ticks / ordering", () => {
  it("tickPercent clamps", () => {
    expect(tickPercent(5, 10)).toBe(50);
    expect(tickPercent(-1, 10)).toBe(0);
    expect(tickPercent(99, 10)).toBe(100);
    expect(tickPercent(5, 0)).toBe(0);
  });
  it("newestFirst puts pending first then saved by id desc", () => {
    const m = [{ id: 3 }, { id: -1 }, { id: 7 }, { id: -2 }, { id: 5 }];
    expect(newestFirst(m).map((x) => x.id)).toEqual([-2, -1, 7, 5, 3]);
  });
});

// WCAG AA: every semantic text color must reach 4.5:1 on its theme surface.
function parseTokens(css: string, selector: string): Record<string, string> {
  const re = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const out: Record<string, string> = {};
  for (const m of (re.exec(css)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("contrast (WCAG AA)", () => {
  const css = tokensCss;
  const light = parseTokens(css, ":root");
  const dark = { ...light, ...parseTokens(css, ".theme-dark") };
  for (const [name, t] of [["light", light], ["dark", dark]] as const) {
    it(`${name}: text/meaning colors on surfaces`, () => {
      for (const surface of ["--surface", "--bg", "--surface-2"]) {
        for (const k of ["--text", "--muted", "--in", "--out", "--male", "--female", "--unknown", "--good", "--warn", "--bad", "--danger"]) {
          expect(ratio(t[k], t[surface]), `${name} ${k} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
    it(`${name}: primary button text`, () => expect(ratio(t["--primary-text"], t["--primary"])).toBeGreaterThanOrEqual(4.5));
  }
});
