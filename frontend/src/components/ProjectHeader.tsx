import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Crumbs } from "./ui/bits";

/** Breadcrumb, project name (with page actions on the right) and the Videos | Settings tabs. */
export default function ProjectHeader({ pid, name, tab, right }: { pid: number; name: string; tab: "videos" | "settings"; right?: ReactNode }) {
  return (
    <>
      <Crumbs items={[{ label: "Projects", to: "/", icon: "⌂" }, { label: name || "Project" }]} />
      <div className="row ptitle">
        <h1>{name || "Project"}</h1>
        <span className="spacer" />
        {right}
      </div>
      <div className="tabs" role="tablist">
        <NavLink end to={`/projects/${pid}`} className={tab === "videos" ? "active" : ""} role="tab" aria-selected={tab === "videos"}>Videos</NavLink>
        <NavLink to={`/projects/${pid}/settings`} className={tab === "settings" ? "active" : ""} role="tab" aria-selected={tab === "settings"}>Settings</NavLink>
      </div>
    </>
  );
}
