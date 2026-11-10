import { memo, useRef, type RefObject } from "react";
import { Button } from "./ui/bits";
import SeekBar from "./SeekBar";
import { fmtTime } from "../lib/format";
import { useTick } from "../lib/useTick";

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  duration: number;
  playing: boolean;
  rate: number;
  marks: { time_s: number; direction: "in" | "out" }[];
  onTogglePlay: () => void;
  onStep: (d: 1 | -1) => void;
  onJumpBack: () => void;
  onSetSpeed: (r: number) => void;
}

function ControllerBar({ videoRef, duration, playing, rate, marks, onTogglePlay, onStep, onJumpBack, onSetSpeed }: Props) {
  const timeEl = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useTick(() => {
    const v = videoRef.current;
    if (!v || !timeEl.current) return;
    const s = fmtTime(v.currentTime);
    if (s !== last.current) { last.current = s; timeEl.current.textContent = s; }
  }, 100);

  return (
    <div className="controls">
      <Button variant="primary" size="lg" className="playbtn" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>{playing ? "⏸" : "▶"}</Button>
      <Button size="icon" onClick={() => onStep(-1)} aria-label="Step one frame back" title="Frame back">⏮</Button>
      <Button size="icon" onClick={() => onStep(1)} aria-label="Step one frame forward" title="Frame forward">⏭</Button>
      <Button onClick={onJumpBack} title="Jump back 3 seconds">↺ 3s</Button>
      <SeekBar videoRef={videoRef} duration={duration} marks={marks} />
      <span className="time num" aria-label="Current time"><span ref={timeEl}>00:00.0</span> / {fmtTime(duration)}</span>
      <div className="speeds" role="group" aria-label="Playback speed">
        {[1, 2, 3, 4].map((r) => <Button key={r} aria-pressed={rate === r} onClick={() => onSetSpeed(r)}>{r}x</Button>)}
      </div>
    </div>
  );
}
export default memo(ControllerBar);
