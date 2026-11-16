import { useEffect, useRef, useState } from "react";
import { api, type EvalMetrics, type Evaluation } from "../api";
import { EVAL_FIELDS, SAME, SAME_TYPES, fmtNum, fmtOver, fmtPct, parseEvalForm, parseTypeTpForm, toEvalForm, toTypeTpForm, tpShortcut, type EvalForm, type TypeTpForm } from "../lib/evaluation";
import { directionIcon } from "../lib/markings";
import { Button, Field, LoadError, Spinner } from "./ui/bits";
import { useToast } from "./ui/Toast";

const EMPTY = toEvalForm({ tp: null, gender_assigned: null, real_male_in_tp: null, real_female_in_tp: null, correct_male: null, correct_female: null });
const scalars = ({ type_tp: _t, ...rest }: Evaluation["inputs"]) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

/** Rows of the result table: label, value, and what it means. */
const rows = (m: EvalMetrics): { label: string; value: string; note: string; gender?: boolean }[] => [
  { label: "Actual (manual)", value: fmtNum(m.actual), note: "your IN + OUT" },
  { label: "System (Sakshi)", value: fmtNum(m.system), note: "Sakshi IN + OUT" },
  { label: "Over / under count", value: fmtOver(m.over_under), note: "system − actual" },
  { label: "FP (false counts)", value: fmtNum(m.fp), note: "system − TP" },
  { label: "FN (missed visitors)", value: fmtNum(m.fn), note: "actual − TP" },
  { label: "Precision", value: fmtPct(m.precision), note: "TP / system" },
  { label: "Recall", value: fmtPct(m.recall), note: "TP / actual" },
  { label: "Gender accuracy (overall)", value: fmtPct(m.gender_accuracy), note: "correct gender / TP", gender: true },
  { label: "Male accuracy", value: fmtPct(m.male_accuracy), note: "correct men / real men in TP", gender: true },
  { label: "Female accuracy", value: fmtPct(m.female_accuracy), note: "correct women / real women in TP", gender: true },
  { label: "Gender coverage", value: fmtPct(m.gender_coverage), note: "counts with a gender / system", gender: true },
];

/** TP and gender numbers are typed here (later they can be filled by timestamp matching); the maths is done by the server. */
export default function EvaluationPanel({ videoId, version }: { videoId: number; version: number }) {
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [form, setForm] = useState<EvalForm>(EMPTY);
  const [saved, setSaved] = useState<EvalForm>(EMPTY);
  const [typeForm, setTypeForm] = useState<TypeTpForm>({});
  const [typeSaved, setTypeSaved] = useState<TypeTpForm>({});
  const [typeErrs, setTypeErrs] = useState<Record<number, string>>({});
  const [errs, setErrs] = useState<Partial<Record<string, string>>>({});
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const first = useRef(true);

  const load = (resetForm: boolean) => {
    api.evaluation(videoId).then((e) => {
      setEv(e);
      if (resetForm) { const f = toEvalForm(scalars(e.inputs)); setForm(f); setSaved(f); const t = toTypeTpForm(e.inputs.type_tp); setTypeForm(t); setTypeSaved(t); }
      setState("ok");
    }).catch((e) => { setLoadErr(e.message); setState("error"); });
  };
  useEffect(() => { first.current = true; setState("loading"); load(true); }, [videoId]); // eslint-disable-line
  // the counts changed (marks or the Sakshi form): refresh the numbers but keep what is being typed
  useEffect(() => { if (first.current) { first.current = false; return; } const t = setTimeout(() => load(false), 500); return () => clearTimeout(t); }, [version]); // eslint-disable-line

  const dirty = !SAME(form, saved) || !SAME_TYPES(typeForm, typeSaved);
  const set = (k: keyof EvalForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { values, errors } = parseEvalForm(form);
    const t = parseTypeTpForm(typeForm);
    setErrs(errors); setTypeErrs(t.errors);
    if (Object.keys(errors).length || Object.keys(t.errors).length) return;
    setSaving(true);
    try {
      const r = await api.putEvaluation(videoId, { ...values, type_tp: t.values });
      setEv(r); const f = toEvalForm(scalars(r.inputs)); setForm(f); setSaved(f);
      const tf = toTypeTpForm(r.inputs.type_tp); setTypeForm(tf); setTypeSaved(tf);
      toast.success("Accuracy numbers saved");
    }
    catch (x) { toast.error(x); } finally { setSaving(false); }
  }

  const shortcut = (kind: "all_real" | "nothing_missed") => {
    if (!ev) return;
    const v = tpShortcut(kind, ev.metrics);
    if (v !== null) set("tp", String(v));
  };

  return (
    <section className="card result" id="accuracy">
      <h2>Accuracy report</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Actual and system come from your marks and the Sakshi result above. Type TP, the number of Sakshi counts that were real visitors; the rest is calculated.
      </p>
      {state === "loading" && <Spinner />}
      {state === "error" && <LoadError message={loadErr} onRetry={() => load(true)} />}
      {state === "ok" && ev && (
        <>
          {ev.problems.length > 0 && <div className="alert" role="alert">The saved numbers no longer add up (marks or the Sakshi result changed): {ev.problems.join("; ")}.</div>}
          <form className="stack" onSubmit={save} noValidate>
            <div className="row sakshi-form">
              {EVAL_FIELDS.filter((f) => !f.gender).map((f) => (
                <Field key={f.key} label={f.label} htmlFor={`ev-${f.key}`} error={errs[f.key]} hint={f.hint}>
                  <input id={`ev-${f.key}`} type="number" inputMode="numeric" min={0} step={1} value={form[f.key]} placeholder="—" aria-invalid={!!errs[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                </Field>
              ))}
              <Button disabled={ev.metrics.system === null} onClick={() => shortcut("all_real")}
                title="Every Sakshi count was a real visitor: TP = system (precision 100%)">All system counts real</Button>
              <Button onClick={() => shortcut("nothing_missed")} title="Every real visitor was captured: TP = actual (recall 100%)">Nothing missed</Button>
            </div>
            <details>
              <summary>Gender numbers (only about the TPs)</summary>
              <div className="row sakshi-form" style={{ marginTop: 8 }}>
                {EVAL_FIELDS.filter((f) => f.gender).map((f) => (
                  <Field key={f.key} label={f.label} htmlFor={`ev-${f.key}`} error={errs[f.key]} hint={f.hint}>
                    <input id={`ev-${f.key}`} type="number" inputMode="numeric" min={0} step={1} value={form[f.key]} placeholder="—" aria-invalid={!!errs[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                  </Field>
                ))}
              </div>
            </details>
            <div className="row">
              <Button variant="primary" type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Button>
              {dirty && <span className="small muted" role="status">Unsaved changes. Results below show the saved numbers.</span>}
            </div>
          </form>
          <h3>By marking</h3>
          <p className="small muted" style={{ margin: 0 }}>The same formulas for each marking, for example Greeting. Type how many of Sakshi's counts of that marking were real (TP) and press Save.</p>
          <div style={{ overflowX: "auto" }}>
            <table className="table cmp">
              <caption className="sr-only">Accuracy per marking</caption>
              <thead><tr><th scope="col">Marking</th><th scope="col">Actual</th><th scope="col">System</th><th scope="col">TP</th><th scope="col">FP</th><th scope="col">FN</th><th scope="col">Precision</th><th scope="col">Recall</th></tr></thead>
              <tbody>
                {ev.types.map((t) => (
                  <tr key={t.id}>
                    <th scope="row">{directionIcon(t.direction)} {t.label}{t.archived ? " (removed)" : ""}</th>
                    <td className="num">{fmtNum(t.metrics.actual)}</td>
                    <td className="num">{t.metrics.system === null ? <span className="na">—</span> : t.metrics.system}</td>
                    <td><input aria-label={`TP for ${t.label}`} aria-invalid={!!typeErrs[t.id]} type="number" inputMode="numeric" min={0} step={1} style={{ width: 80 }} placeholder="—"
                      value={typeForm[t.id] ?? ""} onChange={(e) => setTypeForm((f) => ({ ...f, [t.id]: e.target.value }))} />
                      {typeErrs[t.id] && <span className="err" role="alert"> {typeErrs[t.id]}</span>}</td>
                    <td className="num">{fmtNum(t.metrics.fp)}</td><td className="num">{fmtNum(t.metrics.fn)}</td>
                    <td className="num">{fmtPct(t.metrics.precision)}</td><td className="num">{fmtPct(t.metrics.recall)}</td>
                  </tr>
                ))}
                {!ev.types.length && <tr><td colSpan={8} className="muted">This project has no markings.</td></tr>}
              </tbody>
            </table>
          </div>
          <h3>Footfall (IN + OUT) and gender</h3>
          <table className="table cmp">
            <caption className="sr-only">Accuracy of Sakshi against the manual count</caption>
            <thead><tr><th scope="col">Metric</th><th scope="col">Value</th><th scope="col">How</th></tr></thead>
            <tbody>
              {rows(ev.metrics).map((r) => (
                <tr key={r.label}><th scope="row">{r.label}</th><td className="num">{r.value === "—" ? <span className="na">— not entered</span> : r.value}</td><td className="small muted">{r.note}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
