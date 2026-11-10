import { memo, useRef, type RefObject } from "react";
import { Button } from "./ui/bits";
import Timeline, { type TimelineMark } from "./Timeline";
import { fmtTime } from "../lib/format";
import { useTick } from "../lib/useTick";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  playing: boolean;
  rate: number;
  muted: boolean;
  onToggleMute: () => void;
  marks: TimelineMark[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onTogglePlay: () => void;
  onStep: (d: 1 | -1) => void;
  onJumpBack: () => void;
  onSetSpeed: (r: number) => void;
}

function ControllerBar({ videoRef, duration, playing, rate, muted, onToggleMute, marks, selectedId, onSelect, onTogglePlay, onStep, onJumpBack, onSetSpeed }: Props) {
  const timeEl = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useTick(() => {
    const v = videoRef.current;
    if (!v || !timeEl.current) return;
    const s = fmtTime(v.currentTime);
    if (s !== last.current) { last.current = s; timeEl.current.textContent = s; }
  }, 100);

  const n = Math.max(1, Math.round(rate));
  const frames = `${n} frame${n > 1 ? "s" : ""}`;
  return (
    <div className="controlbox">
    <div className="controls">
      <Button variant="primary" size="lg" className="playbtn" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>{playing ? "⏸" : "▶"}</Button>
      <Button size="icon" onClick={() => onStep(-1)} aria-label={`Step ${frames} back`} title={`Back ${frames} (as many as the speed)`}>⏮</Button>
      <Button size="icon" onClick={() => onStep(1)} aria-label={`Step ${frames} forward`} title={`Forward ${frames} (as many as the speed)`}>⏭</Button>
      <Button onClick={onJumpBack} title="Jump back 3 seconds">↺ 3s</Button>
      <span className="time num" aria-label="Current time"><span ref={timeEl}>00:00.0</span> / {fmtTime(duration)}</span>
      <Button aria-pressed={muted} onClick={onToggleMute} aria-label={muted ? "Unmute video" : "Mute video"} title={muted ? "Video is muted: click to unmute" : "Mute the video's audio"}>{muted ? "🔇 Muted" : "🔊 Audio"}</Button>
      <span className="spacer" />
      <div className="speeds" role="group" aria-label="Playback speed">
        {[1, 2, 3, 4].map((r) => <Button key={r} aria-pressed={rate === r} onClick={() => onSetSpeed(r)}>{r}x</Button>)}
      </div>
    </div>
    <Timeline videoRef={videoRef} duration={duration} marks={marks} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}
export default memo(ControllerBar);
