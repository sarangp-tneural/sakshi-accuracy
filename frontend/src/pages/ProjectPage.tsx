import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import ProjectHeader from "../components/ProjectHeader";
import SettingsPanel from "../components/SettingsPanel";
import ProjectReport from "../components/ProjectReport";
import VideosTab from "../components/VideosTab";

export default function ProjectPage({ tab }: { tab: "videos" | "report" | "settings" }) {
  const pid = Number(useParams().pid);
  const [name, setName] = useState("");
  useEffect(() => { api.projects().then((ps) => setName(ps.find((p) => p.id === pid)?.name ?? "")).catch(() => {}); }, [pid]);
  return (
    <main className="page wide">
      {tab === "videos" ? <VideosTab key={pid} projectId={pid} name={name} /> : tab === "report" ? (
        <>
          <ProjectHeader pid={pid} name={name} tab="report" />
          <ProjectReport pid={pid} />
        </>
      ) : (
        <>
          <ProjectHeader pid={pid} name={name} tab="settings" />
          <div className="card" style={{ maxWidth: 760 }}>
            <p className="muted small" style={{ marginTop: 0 }}>Markings belong to this project. The player and counting settings below belong to your account and apply to every project.</p>
            <SettingsPanel projectId={pid} />
          </div>
        </>
      )}
    </main>
  );
}
