import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { DashGroup, DashVideo, Finding, Health, RolledMetrics, ServiceState } from "../../api";
import { SEVERITY, countOffPct, matchVideo, sortVideos, type SortDir, type SortKey } from "../../lib/dashboard";
import { fmtPct } from "../../lib/evaluation";
import { fmtBytes, fmtDateTime } from "../../lib/format";

const n = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));

export function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="dcard">
      <span className="dlabel">{label}</span>
      <b className={`dvalue num ${tone ?? ""}`}>{value}</b>
      {sub && <span className="dsub small muted">{sub}</span>}
    </div>
  );
}

const tone = (v: number | null, warn = 80, bad = 60): "good" | "warn" | "bad" | undefined => (v === null ? undefined : v < bad ? "bad" : v < warn ? "warn" : "good");

export function SummaryCards({ cards }: { cards: { added: number; marked: number; sakshi: number; tp: number; metrics: RolledMetrics; count_off_pct: number | null; actual_total: number; system_total: number } }) {
  const m = cards.metrics;
  const off = cards.count_off_pct;
  return (
    <div className="dcards" role="group" aria-label="Summary">
      <Card label="Videos" value={String(cards.added)} sub={`${cards.sakshi} with a Sakshi result · ${cards.tp} with TP`} />
      <Card label="Actual vs system" value={`${cards.actual_total} / ${cards.system_total}`} sub="your count / Sakshi's count"
        tone={off === null ? undefined : Math.abs(off) >= 50 ? "bad" : Math.abs(off) >= 20 ? "warn" : "good"} />
      <Card label="Count off" value={off === null ? "—" : `${off > 0 ? "+" : ""}${off}%`} sub={off === null ? "needs Sakshi counts" : off > 0 ? "Sakshi over-counts overall" : off < 0 ? "Sakshi under-counts overall" : "matches"} />
      <Card label="Precision" value={fmtPct(m.precision)} sub={m.videos ? `over ${m.videos} video${m.videos === 1 ? "" : "s"} with TP` : "needs TP"} tone={tone(m.precision)} />
      <Card label="Recall" value={fmtPct(m.recall)} sub={m.videos ? `FP ${n(m.fp)} · FN ${n(m.fn)}` : "needs TP"} tone={tone(m.recall)} />
      <Card label="Gender accuracy" value={fmtPct(m.gender_accuracy)} sub={`coverage ${fmtPct(m.gender_coverage)}`} tone={tone(m.gender_accuracy)} />
    </div>
  );
}

export function Findings({ items }: { items: Finding[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 8);
  if (!items.length) return <p className="muted small">Nothing to flag.</p>;
  return (
    <>
      <ul className="findings">
        {shown.map((f, i) => {
          const s = SEVERITY[f.severity];
          return (
            <li key={i} className={`finding ${s.cls}`}>
              <span className="fi" aria-hidden>{s.icon}</span><span className="sr-only">{s.label}: </span>
              <span className="ft">{f.text}</span>
              {f.link !== "/dashboard" && <Link className="small" to={f.link}>Open</Link>}
            </li>
          );
        })}
      </ul>
      {items.length > 8 && <button className="btn sm" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>}
    </>
  );
}

export function GroupTable({ groups, by }: { groups: DashGroup[]; by: "project" | "camera" }) {
  if (!groups.length) return <p className="muted small">No videos in this selection.</p>;
  return (
    <div className="scroll-x">
      <table className="table cmp">
        <thead><tr>
          <th scope="col">{by === "camera" ? "Camera" : "Project"}</th><th scope="col">Videos</th><th scope="col">With TP</th><th scope="col">Actual</th><th scope="col">System</th>
          <th scope="col">TP</th><th scope="col">FP</th><th scope="col">FN</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">Gender acc.</th>
        </tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id + g.label}>
              <th scope="row">{g.label}</th><td className="num">{g.videos}</td><td className="num">{g.with_tp}</td>
              <td className="num">{n(g.metrics.actual)}</td><td className="num">{n(g.metrics.system)}</td><td className="num">{n(g.metrics.tp)}</td>
              <td className="num">{n(g.metrics.fp)}</td><td className="num">{n(g.metrics.fn)}</td>
              <td className="num">{fmtPct(g.metrics.precision)}</td><td className="num">{fmtPct(g.metrics.recall)}</td><td className="num">{fmtPct(g.metrics.gender_accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COLS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Video" }, { key: "created", label: "Added" }, { key: "actual", label: "Actual" }, { key: "system", label: "System" },
  { key: "off", label: "Off" }, { key: "tp", label: "TP" }, { key: "precision", label: "Precision" }, { key: "recall", label: "Recall" },
];
const PAGE = 25;

export function VideoTable({ videos, truncated }: { videos: DashVideo[]; truncated: boolean }) {
  const [q, setQ] = useState("");
  const [key, setKey] = useState<SortKey>("created");
  const [dir, setDir] = useState<SortDir>("desc");
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => sortVideos(videos.filter((v) => matchVideo(v, q)), key, dir), [videos, q, key, dir]);
  const click = (k: SortKey) => { if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc")); else { setKey(k); setDir(k === "name" ? "asc" : "desc"); } };
  return (
    <>
      <input className="dsearch" type="search" placeholder="Search video, project or camera" aria-label="Search videos" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
      <div className="scroll-x">
        <table className="table cmp">
          <thead><tr>
            {COLS.map((c) => (
              <th key={c.key} scope="col" aria-sort={c.key === key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                <button className="thbtn" onClick={() => click(c.key)}>{c.label}{c.key === key ? (dir === "asc" ? " ▲" : " ▼") : ""}</button>
              </th>
            ))}
            <th scope="col">Where</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, limit).map((v) => {
              const off = countOffPct(v.actual, v.system);
              return (
                <tr key={v.id} className={v.problems.length ? "row-bad" : ""}>
                  <th scope="row"><Link to={`/videos/${v.id}`} title={v.name}>{v.name}</Link>{v.problems.length > 0 && <span className="badge bad" title={v.problems[0]}>check numbers</span>}</th>
                  <td className="small muted nowrap">{fmtDateTime(v.created_at).split(",").slice(0, 2).join(",")}</td>
                  <td className="num">{v.actual}</td><td className="num">{n(v.system)}</td>
                  <td className="num">{off === null ? "—" : `${off > 0 ? "+" : ""}${off}%`}</td>
                  <td className="num">{n(v.tp)}</td><td className="num">{fmtPct(v.metrics.precision)}</td><td className="num">{fmtPct(v.metrics.recall)}</td>
                  <td className="small muted">{v.project}{v.camera ? ` · ${v.camera}` : ""}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="muted">{videos.length ? "No video matches the search." : "No videos in this selection."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row">
        {rows.length > limit && <button className="btn sm" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
        <span className="small muted">{Math.min(limit, rows.length)} of {rows.length}{truncated ? " (the list is limited to the newest 500 videos)" : ""}</span>
      </div>
    </>
  );
}

const STATE = { up: { icon: "●", text: "OK", cls: "good" }, warn: { icon: "●", text: "Low", cls: "warn" }, down: { icon: "●", text: "Down", cls: "bad" }, off: { icon: "○", text: "Off", cls: "muted" } } as const;

function Service({ name, s, detail }: { name: string; s: ServiceState; detail?: string }) {
  const m = STATE[s.state];
  return (
    <li className="svc">
      <span className={`dot ${m.cls}`} aria-hidden>{m.icon}</span><b>{name}</b> <span className={`small ${m.cls}`}>{m.text}</span>
      {(detail || s.note) && <span className="small muted"> {detail}{detail && s.note ? " · " : ""}{s.note}</span>}
    </li>
  );
}

export function HealthPanel({ h }: { h: Health | null }) {
  if (!h) return <p className="muted small">Checking…</p>;
  const r = h.recordings, c = h.cameras, sv = h.services;
  return (
    <div className="health">
      <ul className="svcs">
        <Service name="Disk" s={sv.disk} detail={sv.disk.free_bytes !== undefined ? `${fmtBytes(sv.disk.free_bytes)} free · videos ${fmtBytes(sv.disk.videos_bytes ?? 0)}` : undefined} />
        <Service name="RTSP relay" s={sv.relay} />
        <Service name="Redis (queue)" s={sv.redis} />
      </ul>
      <div className="dcards small-cards">
        <Card label="Recording now" value={String(r.active)} sub={`${r.processing} being saved`} />
        <Card label="Failed (7 days)" value={String(r.failed_7d)} tone={r.failed_7d ? "warn" : "good"} />
        <Card label="Cameras" value={String(c.total)} sub={`${c.recording} recording · ${c.never_recorded} never recorded`} />
      </div>
      {r.stuck.length > 0 && <div className="alert" role="alert">Recording that nothing is working on: {r.stuck.map((s) => <Link key={s.id} to={`/videos/${s.id}`}>{s.name}</Link>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, ", ", x] : [x]), [])}. Check the worker.</div>}
      {r.stuck_unknown && <p className="small muted">Could not check whether recordings are still running (Redis).</p>}
      {c.last_failed.length > 0 && <p className="small"><span className="bad">Last recording failed:</span> {c.last_failed.map((x) => x.name).join(", ")}</p>}
      {h.problems.length > 0 && (
        <details><summary>Latest recording problems ({h.problems.length})</summary>
          <ul className="problems">{h.problems.map((p) => (
            <li key={p.id}><Link to={`/videos/${p.id}`}>{p.name}</Link> <span className={`badge ${p.status === "failed" ? "bad" : "warn"}`}>{p.status}</span> <span className="small muted">{p.reason || "no reason recorded"}</span></li>
          ))}</ul>
        </details>
      )}
      <p className="small muted">Checked {fmtDateTime(h.checked_at)}</p>
    </div>
  );
}
