import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Project } from "../api";
import { Button, EmptyState, Field, LoadError, Spinner } from "../components/ui/bits";
import ProjectCard from "../components/projects/ProjectCard";
import { Modal } from "../components/ui/Modal";
import { useToast } from "../components/ui/Toast";

export default function Projects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [err, setErr] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const now = Date.now();
  const toast = useToast();

  const load = () => api.projects().then((p) => { setProjects(p); setErr(""); }).catch((e) => setErr(e.message));
  useEffect(() => { void load(); }, []);

  const trimmed = name.trim();
  const nameErr = creating && name !== "" && trimmed === "" ? "Enter a name" : trimmed.length > 200 ? "Max 200 characters" : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || nameErr) return;
    setBusy(true);
    try { const p = await api.createProject(trimmed); toast.success("Project created"); setCreating(false); setName(""); nav(`/projects/${p.id}`); }
    catch (x) { toast.error(x); } finally { setBusy(false); }
  }

  return (
    <main className="page">
      <div className="row"><h1 style={{ fontSize: "var(--fs-xl)" }}>Projects</h1><span className="spacer" /><Button variant="primary" onClick={() => setCreating(true)}>+ New project</Button></div>
      {err && <LoadError message={err} onRetry={load} />}
      {projects === null && !err && <div><Spinner /> Loading projects…</div>}
      {projects && projects.length === 0 && <div className="card"><EmptyState title="No projects yet"><Button variant="primary" onClick={() => setCreating(true)}>Create your first project</Button></EmptyState></div>}
      {projects && projects.length > 0 && (
        <div className="pgrid">
          {projects.map((p) => <ProjectCard key={p.id} p={p} now={now} />)}
        </div>
      )}
      {creating && (
        <Modal title="New project" onClose={() => setCreating(false)}>
          <form className="stack" onSubmit={create} noValidate>
            <Field label="Project name" htmlFor="pname" error={nameErr}>
              <input id="pname" type="text" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameErr} autoComplete="off" />
            </Field>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button onClick={() => setCreating(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={busy || !trimmed}>{busy ? "Creating…" : "Create"}</Button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
