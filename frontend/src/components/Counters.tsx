import { forwardRef, memo, useImperativeHandle, useRef } from "react";

export interface CountersHandle { flash: (keys: string[]) => void }
export interface CountValues { in: number; out: number; male: number; female: number; total: number }

const BOXES: { key: keyof CountValues; label: string; icon: string; big?: boolean }[] = [
  { key: "in", label: "IN", icon: "▲", big: true },
  { key: "out", label: "OUT", icon: "▼", big: true },
  { key: "male", label: "Male", icon: "♂" },
  { key: "female", label: "Female", icon: "♀" },
  { key: "total", label: "Total", icon: "Σ" },
];

/** Fixed-size boxes; the flash only animates background-color (no layout change). */
const Counters = forwardRef<CountersHandle, { counts: CountValues }>(function Counters({ counts }, ref) {
  const els = useRef<Record<string, HTMLDivElement | null>>({});
  useImperativeHandle(ref, () => ({
    flash(keys) {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (const k of keys) els.current[k]?.animate([{ backgroundColor: "var(--flash)" }, { backgroundColor: "var(--surface)" }], { duration: 450 });
    },
  }), []);
  return (
    <div className="counters" role="group" aria-label="Live counts">
      {BOXES.map((b) => (
        <div key={b.key} ref={(el) => { els.current[b.key] = el; }} className={`counter c-${b.key} ${b.big ? "big" : ""}`}>
          <span className="cl"><span aria-hidden>{b.icon}</span> {b.label}</span>
          <b className="num">{counts[b.key]}</b>
        </div>
      ))}
    </div>
  );
});
export default memo(Counters);
