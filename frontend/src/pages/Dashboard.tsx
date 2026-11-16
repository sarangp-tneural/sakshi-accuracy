import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Dashboard as Data, type Health } from "../api";
import { Columns, DivergingBars, Funnel, PairBars, TrendChart } from "../components/dashboard/charts";
import { Findings, GroupTable, HealthPanel, SummaryCards, VideoTable } from "../components/dashboard/Panels";
import { EmptyState, LoadError, Spinner } from "../components/ui/bits";
import { PERIODS, countOffPct } from "../lib/dashboard";

const REFRESH_MS = 30_000;

function Section({ title, hint, children, wide }: { title: string; hint?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`card dsection ${wide ? "wide" : ""}`}>
      <h2>{title}</h2>
      {hint && <p className="small muted" style={{ margin: 0 }}>{hint}</p>}
      {children}
    </section>
  );
}

export default function Dashboard() {
  const [sp, setSp] = useSearchParams();
  const projectId = sp.get("p") ? Number(sp.get("p")) : null;
  const days = sp.get("d") !== null ? Number(sp.get("d")) : 30;
  const group = sp.get("g") === "camera" ? "camera" : "project";
  const set = (k: string, v: string | null) => setSp((cur) => { const n = new URLSearchParams(cur); if (v === null) n.delete(k); else n.set(k, v); return n; }, { replace: true });

  const [data, setData] = useState<Data | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => {
      ctl.current?.abort();
      const c = new AbortController(); ctl.current = c;
      if (first) setLoading(true);
      api.dashboard({ project_id: projectId, days, group }, c.signal)
        .then((d) => { if (alive) { setData(d); setErr(""); setLoading(false); } })
        .catch((e) => { if (alive && e.name !== "AbortError") { setErr(e.message); setLoading(false); } });
      api.dashboardHealth(projectId, c.signal).then((h) => { if (alive) setHealth(h); }).catch(() => {});
    };
    load(true);
    const t = setInterval(() => { if (document.visibilityState === "visible") load(false); }, REFRESH_MS);
    return () => { alive = false; clearInterval(t); ctl.current?.abort(); };
  }, [projectId, days, group]);

  const withTp = useMemo(() => (data?.videos ?? []).filter((v) => v.tp !== null && v.metrics.precision !== null).slice(0, 14), [data]);
  const scoredMarkings = useMemo(() => (data?.markings ?? []).filter((m) => m.metrics.precision !== null || m.metrics.recall !== null), [data]);
  const diverging = useMemo(() => (data?.groups ?? []).map((g) => ({ label: g.label, value: countOffPct(g.metrics.actual, g.metrics.system) })), [data]);

  return (
    <main className="page wide dash">
      <div className="row ptitle">
        <h1>Dashboard</h1><span className="spacer" />
        <label className="dfilter">Project
          <select value={projectId ?? ""} onChange={(e) => set("p", e.target.value || null)}>
            <option value="">All projects</option>
            {data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Period">
          {PERIODS.map((p) => <button key={p.days} aria-pressed={days === p.days} onClick={() => set("d", String(p.days))}>{p.label}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Group by">
          <button aria-pressed={group === "project"} onClick={() => set("g", null)}>By project</button>
          <button aria-pressed={group === "camera"} onClick={() => set("g", "camera")}>By camera</button>
        </div>
      </div>

      {err && <LoadError message={err} />}
      {loading && !data && <div><Spinner /> Loading…</div>}
      {data && (
        <>
          <SummaryCards cards={data.cards} />
          {data.cards.added === 0 ? (
            <EmptyState title="No videos in this selection">Try a longer period or another project.</EmptyState>
          ) : (
            <>
              <Section title="Findings" hint="What is worth a look, worst first. Plain rules on your own numbers.">
                <Findings items={data.findings} />
              </Section>
              <div className="dgrid">
                <Section title="Precision and recall per video" hint="Videos with a TP entered (newest first).">
                  <PairBars aName="Precision" bName="Recall" rows={withTp.map((v) => ({ label: v.name, to: `/videos/${v.id}`, a: v.metrics.precision, b: v.metrics.recall }))} />
                </Section>
                <Section title={`Over / under count by ${group}`} hint="Sakshi's total compared with your count, in percent of your count.">
                  <DivergingBars rows={diverging} />
                </Section>
                <Section title="Accuracy trend" hint="By the day each video was added.">
                  <TrendChart points={data.trend} />
                  <div className="legend-inline" aria-hidden><i className="l1k" /> Precision <i className="l2k" /> Recall</div>
                </Section>
                <Section title="By marking" hint="Each marking's accuracy where a TP was entered for it.">
                  {scoredMarkings.length ? (
                    <PairBars aName="Precision" bName="Recall" rows={scoredMarkings.map((m) => ({ label: `${m.label} (${m.marked})`, a: m.metrics.precision, b: m.metrics.recall }))} />
                  ) : <p className="muted small">No marking has a TP yet. Enter it in a video's Accuracy report, under "By marking".</p>}
                  {data.markings.length > scoredMarkings.length && <p className="small muted" style={{ margin: 0 }}>{data.markings.length - scoredMarkings.length} more marking{data.markings.length - scoredMarkings.length === 1 ? "" : "s"} without a TP.</p>}
                </Section>
              </div>
              <Section title={`Results by ${group}`} wide hint="Counts are added up first, then divided, so a big video weighs more than a small one.">
                <GroupTable groups={data.groups} by={group} />
              </Section>
              <Section title="Every video" wide>
                <VideoTable videos={data.videos} truncated={data.truncated} />
              </Section>
              <div className="dgrid">
                <Section title="Counting activity">
                  <b className="small">Marks counted per day</b>
                  <Columns unit="marks" data={data.activity.marks_per_day.map((d) => ({ date: d.date, n: d.marks }))} />
                  <b className="small">How far each video has got</b>
                  <Funnel steps={[
                    { label: "Added", n: data.activity.funnel.added }, { label: "Counted (has marks)", n: data.activity.funnel.marked },
                    { label: "Sakshi result entered", n: data.activity.funnel.sakshi }, { label: "TP entered", n: data.activity.funnel.tp },
                  ]} />
                  <div className="chips">{Object.entries(data.status_counts).map(([s, c]) => <span key={s} className={`badge ${s === "failed" ? "bad" : s === "ready" ? "good" : "partial"}`}>{s} {c}</span>)}</div>
                </Section>
                <Section title="System health"><HealthPanel h={health} /></Section>
              </div>
            </>
          )}
          {data.cards.added === 0 && <Section title="System health"><HealthPanel h={health} /></Section>}
        </>
      )}
    </main>
  );
}
