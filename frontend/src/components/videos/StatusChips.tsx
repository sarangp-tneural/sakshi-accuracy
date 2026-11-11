import { STATUSES, type StatusKey } from "../../lib/videoFilters";
import { Spinner } from "../ui/bits";

const LABEL: Record<StatusKey, string> = { ready: "Ready", connecting: "Attempting", recording: "Recording", processing: "Processing", partial: "Partial", failed: "Failed" };

interface Props {
  counts: Record<"all" | StatusKey, number>;
  selected: StatusKey[];
  onToggle: (s: StatusKey) => void;
  onAll: () => void;
}

/** Status filter chips with counts. Counts already respect the other filters (the server computes them). */
export default function StatusChips({ counts, selected, onToggle, onAll }: Props) {
  return (
    <div className="chips" role="group" aria-label="Filter by status">
      <button type="button" className="chip" aria-pressed={selected.length === 0} onClick={onAll}>All <b className="num">{counts.all}</b></button>
      {STATUSES.map((s) => (
        <button key={s} type="button" className={`chip st-${s}`} aria-pressed={selected.includes(s)} onClick={() => onToggle(s)} disabled={counts[s] === 0 && !selected.includes(s)}>
          {s === "recording" && <span className="live-dot" aria-hidden />}
          {s === "connecting" && <Spinner label="Attempting" />}
          {LABEL[s]} <b className="num">{counts[s]}</b>
        </button>
      ))}
    </div>
  );
}
