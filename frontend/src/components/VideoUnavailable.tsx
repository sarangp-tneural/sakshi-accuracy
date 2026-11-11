import { fmtDateTime } from "../lib/format";

/** Shown wherever the video would play when its file is gone. Drawn inline, so there is no image file to go missing. */
export default function VideoUnavailable({ removedAt, compact = false }: { removedAt?: string | null; compact?: boolean }) {
  return (
    <div className={`vunavail ${compact ? "compact" : ""}`} role="img" aria-label="Video not available">
      <svg viewBox="0 0 160 100" className="vu-art" aria-hidden focusable="false">
        <rect x="6" y="6" width="148" height="88" rx="8" fill="none" stroke="currentColor" strokeWidth="2" opacity=".35" strokeDasharray="5 4" />
        <rect x="46" y="34" width="46" height="32" rx="5" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M92 46 112 36v28L92 54z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <path d="M40 74 118 26" stroke="var(--vu-slash, #e5484d)" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <div className="vu-title">Video not available</div>
      {!compact && (
        <div className="vu-sub">
          The video file was deleted{removedAt ? ` on ${fmtDateTime(removedAt)}` : ""} to free up space. Counts and results are kept.
        </div>
      )}
    </div>
  );
}
