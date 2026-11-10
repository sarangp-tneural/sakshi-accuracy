import { useEffect, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { api } from "../api";
import VideosTab from "../components/VideosTab";
import SettingsPanel from "../components/SettingsPanel";

export default function ProjectPage({ tab }: { tab: "videos" | "settings" }) {
  const pid = Number(useParams().pid);
  const [name, setName] = useState("");
  useEffect(() => { api.projects().then((ps) => setName(ps.find((p) => p.id === pid)?.name ?? "")).catch(() => {}); }, [pid]);
  return (
    <main className="page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/">Projects</Link>/<b style={{ color: "var(--text)" }}>{name || "Project"}</b></nav>
      <h1 style={{ fontSize: "var(--fs-xl)" }}>{name || "Project"}</h1>
      <div className="tabs" role="tablist">
        <NavLink end to={`/projects/${pid}`} className={tab === "videos" ? "active" : ""} role="tab" aria-selected={tab === "videos"}>Videos</NavLink>
        <NavLink to={`/projects/${pid}/settings`} className={tab === "settings" ? "active" : ""} role="tab" aria-selected={tab === "settings"}>Settings</NavLink>
      </div>
      {tab === "videos" ? <VideosTab projectId={pid} /> : (
        <div className="card" style={{ maxWidth: 680 }}>
          <p className="muted small" style={{ marginTop: 0 }}>These settings belong to your account and apply to every project and video.</p>
          <SettingsPanel />
        </div>
      )}
    </main>
  );
}
