import { useEffect, useState } from "react";
import { api, type Sakshi } from "../api";
import { fmtDiff, fmtPercent, type Metric } from "../lib/format";
import { SEVERITY_LABEL, severityOf } from "../lib/severity";
import { Button, EmptyState, Field, LoadError, Spinner } from "./ui/bits";
import { useToast } from "./ui/Toast";

const ROWS: [string, string][] = [["in", "▲ IN"], ["out", "▼ OUT"], ["total", "Σ Total"], ["male", "♂ Male"], ["female", "♀ Female"]];
const FIELDS: [keyof Sakshi, string][] = [["in_count", "IN"], ["out_count", "OUT"], ["male_count", "Male"], ["female_count", "Female"]];
type Form = Record<keyof Sakshi, string>;
const EMPTY: Form = { in_count: "", out_count: "", male_count: "", female_count: "" };
const toForm = (s: Sakshi): Form => Object.fromEntries(FIELDS.map(([k]) => [k, s[k] === null ? "" : String(s[k])])) as Form;

function Cell({ m, kind }: { m: Metric | undefined; kind: "sakshi" | "diff" | "pct" }) {
  if (!m) return <span className="muted">…</span>;
  if (kind === "sakshi") return m.sakshi === null ? <span className="na">— not entered</span> : <span className="num">{m.sakshi}</span>;
  if (m.diff === null) return <span className="na">—</span>;
  const sev = severityOf(m)!;
  if (kind === "diff") return <span className={`sev ${sev} num`}><span aria-hidden>{SEVERITY_LABEL[sev].icon}</span> {fmtDiff(m)}<span className="sr-only"> ({SEVERITY_LABEL[sev].text})</span></span>;
  return m.percent === null ? <span className="na">not defined</span> : <span className={`sev ${sev} num`}>{fmtPercent(m)}</span>;
}

export default function SakshiComparison({ videoId, marksVersion, onExport }: { videoId: number; marksVersion: number; onExport: () => void }) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [saved, setSaved] = useState<Form>(EMPTY);
  const [cmp, setCmp] = useState<Record<string, Metric> | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<keyof Sakshi, string>>>({});
  const toast = useToast();

  const refresh = () => api.comparison(videoId).then(setCmp).catch((e) => toast.error(e));
  const load = () => {
    setState("loading");
    api.sakshi(videoId).then((s) => { setForm(toForm(s)); setSaved(toForm(s)); setState("ok"); })
      .catch((e) => { setLoadErr(e.message); setState("error"); });
  };
  useEffect(load, [videoId]); // eslint-disable-line
  useEffect(() => { const t = setTimeout(refresh, 400); return () => clearTimeout(t); }, [videoId, marksVersion]); // eslint-disable-line

  const dirty = FIELDS.some(([k]) => form[k] !== saved[k]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errs = {};
    for (const [k] of FIELDS) {
      const v = form[k].trim();
      if (v !== "" && (!/^\d+$/.test(v))) next[k] = "Whole number, 0 or more";
    }
    setErrs(next);
    if (Object.keys(next).length) return;
    const body = Object.fromEntries(FIELDS.map(([k]) => [k, form[k].trim() === "" ? null : Number(form[k])])) as unknown as Sakshi;
    setSaving(true);
    try { await api.putSakshi(videoId, body); setSaved(form); await refresh(); toast.success("Sakshi result saved"); }
    catch (x) { toast.error(x); } finally { setSaving(false); }
  }

  return (
    <section className="card result" id="result">
      <div className="row"><h2>Sakshi result &amp; comparison</h2><span className="spacer" /><Button onClick={onExport}>⭳ Export…</Button></div>
      {state === "loading" && <Spinner />}
      {state === "error" && <LoadError message={loadErr} onRetry={load} />}
      {state === "ok" && (
        <form className="row sakshi-form" onSubmit={save} noValidate>
          {FIELDS.map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`sk-${k}`} error={errs[k]} hint="blank = not entered">
              <input id={`sk-${k}`} type="number" inputMode="numeric" min={0} step={1} value={form[k]} aria-invalid={!!errs[k]} placeholder="—"
                onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </Field>
          ))}
          <Button variant="primary" type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Button>
          {dirty && <span className="small muted" role="status">Unsaved changes</span>}
        </form>
      )}
      <table className="table cmp">
        <caption className="sr-only">Manual count versus Sakshi, difference is Sakshi minus manual</caption>
        <thead><tr><th scope="col">Metric</th><th scope="col">Manual</th><th scope="col">Sakshi</th><th scope="col">Difference</th><th scope="col">% of manual</th></tr></thead>
        <tbody>
          {ROWS.map(([k, label]) => { const m = cmp?.[k]; return (
            <tr key={k}><th scope="row">{label}</th><td className="num">{m?.manual ?? "…"}</td><td><Cell m={m} kind="sakshi" /></td><td><Cell m={m} kind="diff" /></td><td><Cell m={m} kind="pct" /></td></tr>
          ); })}
        </tbody>
      </table>
      <p className="small muted" style={{ margin: 0 }}>
        Difference = Sakshi − manual. ✓ within 5% · ! 5–15% · ✕ over 15%. “not entered” and “not defined” are not zero.
      </p>
      {cmp && state === "ok" && !Object.values(cmp).some((m) => m.manual) && <EmptyState title="No manual marks yet">Count while watching, then compare here.</EmptyState>}
    </section>
  );
}
