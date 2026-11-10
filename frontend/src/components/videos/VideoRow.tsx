import { memo } from "react";
import { Link } from "react-router-dom";
import type { Video } from "../../api";
import { fmtClock, fmtDateShort, fmtTime, recordingProgress } from "../../lib/format";
import { genderParts } from "../../lib/videoFilters";
import { isExportable, isOpenable } from "../../lib/videoRow";
import { videoDetails } from "../../lib/videoDetails";
import { Button, Spinner } from "../ui/bits";
import RowMenu, { type MenuItem } from "./RowMenu";

export const COLS = 9;

function StatusCell({ v, now }: { v: Video; now: number }) {
  if (v.status === "recording") {
    const p = v.started_at ? recordingProgress(v.started_at, v.rtsp_minutes ?? 0, now) : null;
    return (
      <div>
        <span className="badge recording"><span className="live-dot" aria-hidden /> Recording</span>
        <div className="small num muted">{p ? `${fmtClock(p.elapsed)} / ${fmtClock(p.total)}` : "starting…"}</div>
      </div>
    );
  }
  if (v.status === "processing") return <span className="badge processing"><Spinner label="Processing" /> Processing</span>;
  const label = v.status === "ready" ? "Ready" : v.status === "partial" ? "Partial" : "Failed";
  return <span className={`badge ${v.status}`} title={v.status_reason ?? undefined}>{label}</span>;
}

interface Props {
  v: Video;
  now: number;
  expanded: boolean;
  onToggle: (id: number) => void;
  onOpen: (v: Video) => void;
  onStop: (v: Video) => void;
  onExport: (v: Video) => void;
  onDelete: (v: Video) => void;
}

function VideoRow({ v, now, expanded, onToggle, onOpen, onStop, onExport, onDelete }: Props) {
  const openable = isOpenable(v);
  const menu: MenuItem[] = [];
  if (isExportable(v)) menu.push({ label: "Export…", onSelect: () => onExport(v) });
  menu.push({ label: "Delete…", danger: true, onSelect: () => onDelete(v) });
  const detailId = `vd-${v.id}`;
  return (
    <>
      <tr className={openable ? "clickable" : undefined}
        onClick={(e) => {
          if (!openable) return;
          if ((e.target as HTMLElement).closest("a, button, input, select, textarea, [role=menu]")) return; // those do their own thing
          if (window.getSelection()?.toString()) return; // the user was selecting text
          onOpen(v);
        }}>
        <td className="c-name">
          <div className="namecell">
            <button type="button" className="chev" aria-expanded={expanded} aria-controls={detailId} aria-label={`${expanded ? "Hide" : "Show"} details for ${v.name}`} onClick={() => onToggle(v.id)}>{expanded ? "▾" : "▸"}</button>
            <div className="nm">
              {openable ? <Link className="vname" to={`/videos/${v.id}`} title={v.name}>{v.name}</Link> : <span className="vname" title={v.name}>{v.name}</span>}
              <span className="added-inline small muted">{fmtDateShort(v.created_at)}</span>
            </div>
          </div>
        </td>
        <td><span className="badge unknown">{v.source === "rtsp" ? "RTSP" : "Upload"}</span></td>
        <td><StatusCell v={v} now={now} /></td>
        <td className="num">{v.duration_s ? fmtTime(v.duration_s) : <span className="muted">—</span>}</td>
        <td className="num nowrap">
          <span className="mk in">IN {v.mark_in}</span> <span className="muted">/</span> <span className="mk out">OUT {v.mark_out}</span>
        </td>
        <td className="num nowrap" aria-label={`Male ${v.mark_male}, female ${v.mark_female}, unknown ${v.mark_unknown}`}>
          {genderParts(v).map((p, i) => (
            <span key={p.key}>{i > 0 && <span className="muted"> · </span>}<span className={`g ${p.key}`}>{p.letter} {p.n}</span></span>
          ))}
        </td>
        <td>{v.sakshi_entered ? <span className="sak yes">✓ entered</span> : <span className="sak no">not entered</span>}</td>
        <td className="c-added small muted nowrap">{fmtDateShort(v.created_at)}</td>
        <td className="c-actions">
          <div className="acts">
            {openable && <Link className="btn sm primary" to={`/videos/${v.id}`}>Count</Link>}
            {v.status === "recording"
              ? <Button size="sm" variant="danger" onClick={() => onStop(v)}>■ Stop</Button>
              : <RowMenu label={`More actions for ${v.name}`} items={menu} />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="vdetail" id={detailId}>
          <td colSpan={COLS}>
            <dl className="vgrid">
              {videoDetails(v, now).map((d) => (
                <div key={d.label} className={`vd ${d.wide ? "wide" : ""} ${d.tone ?? ""}`}>
                  <dt>{d.label}</dt>
                  <dd className={d.mono ? "mono" : undefined}>{d.value}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
export default memo(VideoRow);
