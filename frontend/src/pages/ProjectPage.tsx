import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import ProjectHeader from "../components/ProjectHeader";
import SettingsPanel from "../components/SettingsPanel";
import VideosTab from "../components/VideosTab";

export default function ProjectPage({ tab }: { tab: "videos" | "settings" }) {
  const pid = Number(useParams().pid);
  const [name, setName] = useState("");
  useEffect(() => { api.projects().then((ps) => setName(ps.find((p) => p.id === pid)?.name ?? "")).catch(() => {}); }, [pid]);
  return (
    <main className="page wide">
      {tab === "videos" ? <VideosTab key={pid} projectId={pid} name={name} /> : (
        <>
          <ProjectHeader pid={pid} name={name} tab="settings" />
          <div className="card" style={{ maxWidth: 680 }}>
            <p className="muted small" style={{ marginTop: 0 }}>These settings belong to your account and apply to every project and video.</p>
            <SettingsPanel />
          </div>
        </>
      )}
    </main>
  );
}
