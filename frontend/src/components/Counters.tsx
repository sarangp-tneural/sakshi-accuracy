import { forwardRef, memo, useImperativeHandle, useRef } from "react";
import type { MarkingType } from "../api";
import { directionIcon, typeColor } from "../lib/markings";

export interface CountersHandle { flash: (keys: string[]) => void }
export interface CountValues { in: number; out: number; total: number; types: { type: MarkingType; n: number }[] }

/** Fixed-size boxes; the flash only animates background-color (no layout change). Flash keys: "in", "out", "total", "t:<marking id>". */
const Counters = forwardRef<CountersHandle, { counts: CountValues }>(function Counters({ counts }, ref) {
  const els = useRef<Record<string, HTMLDivElement | null>>({});
  useImperativeHandle(ref, () => ({
    flash(keys) {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      for (const k of keys) els.current[k]?.animate([{ backgroundColor: "var(--flash)" }, { backgroundColor: "var(--surface)" }], { duration: 450 });
    },
  }), []);
  const box = (key: string, cls: string, label: React.ReactNode, n: number, color?: string) => (
    <div key={key} ref={(el) => { els.current[key] = el; }} className={`counter ${cls}`}>
      <span className="cl" style={color ? { color } : undefined}>{label}</span>
      <b className="num" style={color ? { color } : undefined}>{n}</b>
    </div>
  );
  return (
    <div className="counters" role="group" aria-label="Live counts">
      {box("in", "c-in big", <><span aria-hidden>▲</span> IN</>, counts.in)}
      {box("out", "c-out big", <><span aria-hidden>▼</span> OUT</>, counts.out)}
      {counts.types.map(({ type, n }) => box("t:" + type.id, "c-type", <><span aria-hidden>{directionIcon(type.direction)}</span> {type.label}</>, n, typeColor(type)))}
      {box("total", "c-total", <><span aria-hidden>Σ</span> Total</>, counts.total)}
    </div>
  );
});
export default memo(Counters);
