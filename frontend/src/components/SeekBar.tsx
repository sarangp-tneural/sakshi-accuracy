import { memo, useEffect, useRef, type RefObject } from "react";
import { useTick } from "../lib/useTick";
import { tickPercent } from "../lib/ticks";

interface M { time_s: number; direction: "in" | "out" }
const PAD = 10; // half of the thumb, so ticks line up with the thumb travel

/** Range input + a tick strip. Mark ticks are drawn only when marks/size change, never per frame. */
function SeekBar({ videoRef, duration, marks }: { videoRef: RefObject<HTMLVideoElement | null>; duration: number; marks: M[] }) {
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useTick(() => {
    const v = videoRef.current, i = input.current;
    if (v && i && !dragging.current) i.value = String(v.currentTime);
  }, 100);

  useEffect(() => {
    const c = canvas.current, w = wrap.current;
    if (!c || !w) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = w.clientWidth, cssH = 12;
      c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
      c.style.width = cssW + "px"; c.style.height = cssH + "px";
      const g = c.getContext("2d")!;
      g.clearRect(0, 0, c.width, c.height);
      const cs = getComputedStyle(document.documentElement);
      const col = { in: cs.getPropertyValue("--in").trim(), out: cs.getPropertyValue("--out").trim() };
      const span = cssW - 2 * PAD;
      for (const m of marks) {
        const x = (PAD + (tickPercent(m.time_s, duration) / 100) * span) * dpr;
        g.fillStyle = col[m.direction];
        // IN ticks in the top half, OUT in the bottom half: readable even without color
        g.fillRect(x - dpr, m.direction === "in" ? 0 : c.height / 2, 2 * dpr, c.height / 2);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(w);
    return () => ro.disconnect();
  }, [marks, duration]);

  return (
    <div className="seek" ref={wrap}>
      <canvas ref={canvas} aria-hidden />
      <input ref={input} type="range" min={0} max={duration || 1} step={0.01} defaultValue={0} aria-label="Seek"
        onPointerDown={() => { dragging.current = true; }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onBlur={() => { dragging.current = false; }}
        onInput={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.currentTarget.value); }} />
    </div>
  );
}
export default memo(SeekBar);
