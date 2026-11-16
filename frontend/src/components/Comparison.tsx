import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Comparison, type MarkingType, type Sakshi } from "../api";
import { fmtDiff, fmtPercent, type Metric } from "../lib/format";
import { activeTypes, directionIcon } from "../lib/markings";
import { SEVERITY_LABEL, severityOf } from "../lib/severity";
import { Button, EmptyState, Field, LoadError, Spinner } from "./ui/bits";
import { useToast } from "./ui/Toast";

type Form = Record<number, string>;
const toForm = (s: Sakshi, types: MarkingType[]): Form =>
  Object.fromEntries(types.map((t) => [t.id, s.counts[String(t.id)] === undefined ? "" : String(s.counts[String(t.id)])]));
const LEGACY_LABEL: Record<string, string> = { in: "IN", out: "OUT", male: "Male", female: "Female" };

function Cell({ m, kind }: { m: Metric | undefined; kind: "sakshi" | "diff" | "pct" }) {
  if (!m) return <span className="muted">…</span>;
  if (kind === "sakshi") return m.sakshi === null ? <span className="na">— not entered</span> : <span className="num">{m.sakshi}</span>;
  if (m.diff === null) return <span className="na">—</span>;
  const sev = severityOf(m)!;
  if (kind === "diff") return <span className={`sev ${sev} num`}><span aria-hidden>{SEVERITY_LABEL[sev].icon}</span> {fmtDiff(m)}<span className="sr-only"> ({SEVERITY_LABEL[sev].text})</span></span>;
  return m.percent === null ? <span className="na">not defined</span> : <span className={`sev ${sev} num`}>{fmtPercent(m)}</span>;
}

export default function SakshiComparison({ videoId, types, marksVersion, onExport }: { videoId: number; types: MarkingType[]; marksVersion: number; onExport: () => void }) {
  const fields = useMemo(() => activeTypes(types), [types]);
  const [form, setForm] = useState<Form>({});
  const [saved, setSaved] = useState<Form>({});
  const [legacy, setLegacy] = useState<Sakshi["legacy"]>(null);
  const [cmp, setCmp] = useState<Comparison | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [loadErr, setLoadErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [errs, setErrs] = useState<Record<number, string>>({});
  const toast = useToast();
  const serverCounts = useRef<Sakshi["counts"]>({});

  const refresh = () => api.comparison(videoId).then(setCmp).catch((e) => toast.error(e));
  const load = () => {
    setState("loading");
    api.sakshi(videoId).then((s) => { serverCounts.current = s.counts; setLegacy(s.legacy ?? null); setState("ok"); })
      .catch((e) => { setLoadErr(e.message); setState("error"); });
  };
  useEffect(load, [videoId]); // eslint-disable-line
  // the form follows the project's markings; typed-but-unsaved text for markings that still exist is kept
  useEffect(() => {
    if (state !== "ok") return;
    const fresh = toForm({ counts: serverCounts.current }, fields);
    setSaved(fresh);
    setForm((cur) => Object.fromEntries(fields.map((t) => [t.id, cur[t.id] !== undefined ? cur[t.id] : fresh[t.id]])));
  }, [state, fields]);
  useEffect(() => { const t = setTimeout(refresh, 400); return () => clearTimeout(t); }, [videoId, marksVersion, types]); // eslint-disable-line

  const dirty = fields.some((t) => (form[t.id] ?? "") !== (saved[t.id] ?? ""));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next: Record<number, string> = {};
    for (const t of fields) {
      const v = (form[t.id] ?? "").trim();
      if (v !== "" && !/^\d+$/.test(v)) next[t.id] = "Whole number, 0 or more";
    }
    setErrs(next);
    if (Object.keys(next).length) return;
    const counts: Sakshi["counts"] = {};
    for (const t of fields) { const v = (form[t.id] ?? "").trim(); if (v !== "") counts[String(t.id)] = Number(v); }
    setSaving(true);
    try { const s = await api.putSakshi(videoId, { counts }); serverCounts.current = s.counts; setSaved({ ...form }); setLegacy(s.legacy ?? null); await refresh(); toast.success("Sakshi result saved"); }
    catch (x) { toast.error(x); } finally { setSaving(false); }
  }

  const rows: { key: string; label: string; m: Metric | undefined }[] = [
    { key: "in", label: "▲ IN", m: cmp?.in }, { key: "out", label: "▼ OUT", m: cmp?.out }, { key: "total", label: "Σ Total", m: cmp?.total },
    ...(cmp?.types ?? []).map((t) => ({ key: `t${t.id}`, label: `${directionIcon(t.direction)} ${t.label}${t.archived ? " (removed)" : ""}`, m: t as Metric })),
  ];
  const legacyOnly = legacy && !Object.keys(serverCounts.current).length;

  return (
    <section className="card result" id="result">
      <div className="row"><h2>Sakshi result &amp; comparison</h2><span className="spacer" /><Button onClick={onExport}>⭳ Export…</Button></div>
      {state === "loading" && <Spinner />}
      {state === "error" && <LoadError message={loadErr} onRetry={load} />}
      {state === "ok" && (
        <form className="row sakshi-form" onSubmit={save} noValidate>
          {fields.map((t) => (
            <Field key={t.id} label={`${directionIcon(t.direction)} ${t.label}`} htmlFor={`sk-${t.id}`} error={errs[t.id]} hint="blank = not entered">
              <input id={`sk-${t.id}`} type="number" inputMode="numeric" min={0} step={1} value={form[t.id] ?? ""} aria-invalid={!!errs[t.id]} placeholder="—"
                onChange={(e) => setForm({ ...form, [t.id]: e.target.value })} />
            </Field>
          ))}
          {!fields.length && <span className="small muted">This project has no markings. Add some in Settings.</span>}
          <Button variant="primary" type="submit" disabled={saving || !dirty}>{saving ? "Saving…" : "Save"}</Button>
          {dirty && <span className="small muted" role="status">Unsaved changes</span>}
        </form>
      )}
      {legacyOnly && (
        <p className="small muted" style={{ margin: 0 }}>
          Entered before markings were configurable: {Object.entries(legacy!).map(([k, v]) => `${LEGACY_LABEL[k] ?? k} ${v}`).join(" · ")}. IN and OUT still compare; fill in the fields above to compare each marking.
        </p>
      )}
      <table className="table cmp">
        <caption className="sr-only">Manual count versus Sakshi, difference is Sakshi minus manual</caption>
        <thead><tr><th scope="col">Metric</th><th scope="col">Manual</th><th scope="col">Sakshi</th><th scope="col">Difference</th><th scope="col">% of manual</th></tr></thead>
        <tbody>
          {rows.map(({ key, label, m }) => (
            <tr key={key}><th scope="row">{label}</th><td className="num">{m?.manual ?? "…"}</td><td><Cell m={m} kind="sakshi" /></td><td><Cell m={m} kind="diff" /></td><td><Cell m={m} kind="pct" /></td></tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ margin: 0 }}>
        Difference = Sakshi − manual. ✓ within 5% · ! 5–15% · ✕ over 15%. “not entered” and “not defined” are not zero.
      </p>
      {cmp && state === "ok" && !cmp.total.manual && !cmp.types.some((m) => m.manual) && <EmptyState title="No manual marks yet">Count while watching, then compare here.</EmptyState>}
    </section>
  );
}
