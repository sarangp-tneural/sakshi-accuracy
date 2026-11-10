import { Link } from "react-router-dom";
import type { Project } from "../../api";
import { comparedPct, fmtAgo, fmtTotalDuration, projectSummary, stateBadges } from "../../lib/projectCard";

/** A project at a glance: what is in it, what is happening now, and how far the Sakshi comparison has got. */
export default function ProjectCard({ p, now }: { p: Project; now: number }) {
  const badges = stateBadges(p);
  const pct = comparedPct(p.compared_count, p.video_count);
  return (
    <Link to={`/projects/${p.id}`} className="pcard" aria-label={`Open project ${p.name}. ${projectSummary(p)}`}>
      <div className="pc-head">
        <h2 className="pc-name" title={p.name}>{p.name}</h2>
        <span className="pc-open" aria-hidden>Open →</span>
      </div>
      <p className="pc-meta small muted">
        Created {new Date(p.created_at).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })} · Active {fmtAgo(p.last_activity_at, now)}
      </p>

      <div className="pc-states">
        {badges.length === 0
          ? <span className="small muted">{p.video_count === 0 ? "No videos yet" : "Nothing recording or processing"}</span>
          : badges.map((b) => (
            <span key={b.key} className={`badge ${b.key}`}>
              {b.key === "recording" && <span className="live-dot" aria-hidden />}{b.label} {b.n}
            </span>
          ))}
      </div>

      <dl className="pc-stats">
        <div><dd className="num">{p.video_count}</dd><dt>{p.video_count === 1 ? "video" : "videos"}</dt></div>
        <div><dd className="num">{p.camera_count}</dd><dt>{p.camera_count === 1 ? "camera" : "cameras"}</dt></div>
        <div><dd className="num">{p.mark_total}</dd><dt>{p.mark_total === 1 ? "mark" : "marks"}</dt></div>
        <div><dd className="num">{fmtTotalDuration(p.total_duration_s)}</dd><dt>of video</dt></div>
      </dl>

      <p className="pc-marks small">
        <span className="mk in">▲ IN {p.mark_in}</span> <span className="muted">/</span> <span className="mk out">▼ OUT {p.mark_out}</span>
      </p>

      <div className="pc-compare">
        <div className="row small"><span>Compared with Sakshi</span><span className="spacer" /><b className="num">{p.compared_count} of {p.video_count}</b></div>
        <div className="progress" role="progressbar" aria-label="Videos compared with Sakshi" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
      </div>
    </Link>
  );
}
