import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type ProjectEvaluation } from "../api";
import { fmtNum, fmtPct } from "../lib/evaluation";
import { LoadError, Spinner } from "./ui/bits";

/** Accuracy of every video of the project, with totals (counts summed first, then divided). */
export default function ProjectReport({ pid }: { pid: number }) {
  const [data, setData] = useState<ProjectEvaluation | null>(null);
  const [err, setErr] = useState("");
  const load = () => { setErr(""); api.projectEvaluation(pid).then(setData).catch((e) => setErr(e.message)); };
  useEffect(load, [pid]); // eslint-disable-line
  if (err) return <LoadError message={err} onRetry={load} />;
  if (!data) return <Spinner />;
  const cells = (m: ProjectEvaluation["total"] | ProjectEvaluation["videos"][number]["metrics"]) => [
    fmtNum(m.actual), fmtNum(m.system), fmtNum(m.tp), fmtNum(m.fp), fmtNum(m.fn),
    fmtPct(m.precision), fmtPct(m.recall), fmtPct(m.gender_accuracy), fmtPct(m.gender_coverage),
  ];
  const t = data.total;
  return (
    <div className="card">
      <p className="muted small" style={{ marginTop: 0 }}>
        The total row adds up actual, system and TP over the videos that have a Sakshi count and a TP ({t.videos} of {data.videos.length}), then divides. It is not an average of the percentages.
        Fill in TP on each video’s Count screen under “Accuracy report”.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table className="table cmp">
          <thead><tr>
            <th scope="col">Video</th><th scope="col">Actual</th><th scope="col">System</th><th scope="col">TP</th><th scope="col">FP</th><th scope="col">FN</th>
            <th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">Gender acc.</th><th scope="col">Gender coverage</th>
          </tr></thead>
          <tbody>
            {data.videos.map((v) => (
              <tr key={v.id}><th scope="row"><Link to={`/videos/${v.id}`}>{v.name}</Link></th>{cells(v.metrics).map((c, i) => <td key={i} className="num">{c}</td>)}</tr>
            ))}
            {!data.videos.length && <tr><td colSpan={10} className="muted">No videos yet.</td></tr>}
          </tbody>
          <tfoot><tr><th scope="row">Total</th>{cells(t).map((c, i) => <td key={i} className="num"><b>{c}</b></td>)}</tr></tfoot>
        </table>
      </div>
      {data.types.length > 0 && (
        <>
          <h3>By marking</h3>
          <div style={{ overflowX: "auto" }}>
            <table className="table cmp">
              <thead><tr><th scope="col">Marking</th><th scope="col">Actual</th><th scope="col">System</th><th scope="col">TP</th><th scope="col">FP</th><th scope="col">FN</th><th scope="col">Precision</th><th scope="col">Recall</th><th scope="col">Videos</th></tr></thead>
              <tbody>
                {data.types.map((t) => (
                  <tr key={t.id}><th scope="row">{t.label}{t.archived ? " (removed)" : ""}</th>
                    {[t.metrics.actual, t.metrics.system, t.metrics.tp, t.metrics.fp, t.metrics.fn].map((v, i) => <td key={i} className="num">{fmtNum(v)}</td>)}
                    <td className="num">{fmtPct(t.metrics.precision)}</td><td className="num">{fmtPct(t.metrics.recall)}</td><td className="num">{t.metrics.videos}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
