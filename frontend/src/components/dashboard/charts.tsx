import { Link } from "react-router-dom";
import { linePaths, niceMax, shortDay } from "../../lib/dashboard";
import { fmtPct } from "../../lib/evaluation";

/** Two bars per row (for example precision and recall), 0 to 100 %. A missing value shows as "—" with no bar. */
export function PairBars({ rows, aName, bName }: { rows: { label: string; to?: string; a: number | null; b: number | null }[]; aName: string; bName: string }) {
  if (!rows.length) return <p className="muted small">Nothing to show yet.</p>;
  return (
    <div className="hbars" role="list">
      <div className="legend-inline" aria-hidden><i className="k1" /> {aName} <i className="k2" /> {bName}</div>
      {rows.map((r, i) => (
        <div className="hrow" role="listitem" key={i} aria-label={`${r.label}: ${aName} ${fmtPct(r.a)}, ${bName} ${fmtPct(r.b)}`}>
          <span className="hl" title={r.label}>{r.to ? <Link to={r.to}>{r.label}</Link> : r.label}</span>
          <div className="htracks">
            {([[r.a, "k1"], [r.b, "k2"]] as const).map(([v, k]) => (
              <div className="hline" key={k}>
                <div className="htrack"><div className={`hbar ${k}`} style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} /></div>
                <span className="hv num">{fmtPct(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bars that go left (under-count, negative) or right (over-count, positive) from a centre line. */
export function DivergingBars({ rows }: { rows: { label: string; value: number | null; note?: string }[] }) {
  const data = rows.filter((r) => r.value !== null);
  if (!data.length) return <p className="muted small">Nothing to compare yet. Enter Sakshi's counts.</p>;
  const max = niceMax(Math.max(...data.map((r) => Math.abs(r.value!)), 10));
  return (
    <div className="dbars" role="list">
      {data.map((r, i) => {
        const v = r.value!, w = (Math.abs(v) / max) * 50;
        return (
          <div className="drow" role="listitem" key={i} aria-label={`${r.label}: ${v > 0 ? "+" : ""}${v}% ${v > 0 ? "over" : "under"}-counted`}>
            <span className="hl" title={r.label}>{r.label}</span>
            <div className="dtrack"><span className="dzero" />
              <div className={`dbar ${v >= 0 ? "over" : "under"}`} style={v >= 0 ? { left: "50%", width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` }} />
            </div>
            <span className="hv num">{v > 0 ? "+" : ""}{v}%</span>
          </div>
        );
      })}
      <div className="dscale small muted"><span>← under-counted</span><span>over-counted →</span></div>
    </div>
  );
}

/** Precision and recall by day, drawn as two lines (gaps where a day has no TP). */
export function TrendChart({ points }: { points: { date: string; precision: number | null; recall: number | null; videos: number }[] }) {
  if (points.length < 2) return <p className="muted small">The trend needs at least two days with results.</p>;
  const W = 640, H = 170, P = { l: 32, r: 8, t: 8, b: 22 };
  const w = W - P.l - P.r, h = H - P.t - P.b;
  const draw = (vals: (number | null)[], cls: string) => linePaths(vals, w, h).map((run, i) => (
    run.length === 1
      ? <circle key={cls + i} className={cls} cx={+run[0].split(",")[0]} cy={+run[0].split(",")[1]} r={3.5} />
      : <polyline key={cls + i} className={cls} fill="none" strokeWidth={2.5} points={run.join(" ")} />
  ));
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Precision and recall by day, ${points.length} days`}>
      {[0, 50, 100].map((g) => (
        <g key={g}><line x1={P.l} x2={W - P.r} y1={P.t + h - (g / 100) * h} y2={P.t + h - (g / 100) * h} className="grid" /><text x={P.l - 6} y={P.t + h - (g / 100) * h + 4} textAnchor="end" className="axis">{g}%</text></g>
      ))}
      <g transform={`translate(${P.l},${P.t})`}>{draw(points.map((p) => p.precision), "l1")}{draw(points.map((p) => p.recall), "l2")}</g>
      {labelIdx.map((i, k) => (
        <text key={i} x={P.l + (i / (points.length - 1)) * w} y={H - 5} textAnchor={k === 0 ? "start" : k === 2 ? "end" : "middle"} className="axis">{shortDay(points[i].date)}</text>
      ))}
    </svg>
  );
}

/** Simple columns (for example marks per day). */
export function Columns({ data, unit }: { data: { date: string; n: number }[]; unit: string }) {
  if (!data.length) return <p className="muted small">Nothing counted in this period.</p>;
  const max = niceMax(Math.max(...data.map((d) => d.n)));
  const W = 640, H = 120, bw = Math.min(28, (W - 8) / data.length - 3);
  return (
    <svg className="cols" viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`${unit} per day, ${data.length} days, most ${Math.max(...data.map((d) => d.n))}`}>
      {data.map((d, i) => {
        const x = 4 + i * ((W - 8) / data.length), bh = (d.n / max) * H;
        return <g key={d.date}><rect className="col" x={x} y={H - bh} width={Math.max(bw, 2)} height={bh} rx={2}><title>{`${shortDay(d.date)}: ${d.n} ${unit}`}</title></rect></g>;
      })}
      <text x={4} y={H + 14} className="axis">{shortDay(data[0].date)}</text>
      <text x={W - 4} y={H + 14} textAnchor="end" className="axis">{shortDay(data[data.length - 1].date)}</text>
    </svg>
  );
}

/** Steps from "added" down to "TP entered": how far each video has got. */
export function Funnel({ steps }: { steps: { label: string; n: number }[] }) {
  const top = Math.max(1, steps[0]?.n ?? 0);
  return (
    <div className="funnel" role="list">
      {steps.map((s) => (
        <div className="frow" role="listitem" key={s.label} aria-label={`${s.label}: ${s.n} of ${top}`}>
          <span className="hl">{s.label}</span>
          <div className="hline">
            <div className="htrack"><div className="hbar k1" style={{ width: `${(s.n / top) * 100}%` }} /></div>
            <span className="hv num">{s.n}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
