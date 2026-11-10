import { forwardRef, memo, useImperativeHandle, useRef } from "react";
import type { Gender } from "../lib/semantic";
import { GENDER_META } from "../lib/semantic";

export interface PopupHandle {
  show: (p: { kind: "in" | "out" | "undo"; text: string; gender?: Gender; times?: number }) => void;
}

/** Imperative on purpose: a key press writes straight to the DOM, no React render in the hot path. */
const Popup = forwardRef<PopupHandle>(function Popup(_, ref) {
  const root = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const gender = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const mult = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);

  useImperativeHandle(ref, () => ({
    show({ kind, text: t, gender: g, times }) {
      const el = root.current; if (!el) return;
      el.dataset.kind = kind;
      icon.current!.textContent = kind === "in" ? "▲" : kind === "out" ? "▼" : "↶";
      gender.current!.textContent = g && g !== "unknown" ? GENDER_META[g].icon : "";
      gender.current!.dataset.gender = g ?? "";
      text.current!.textContent = t;
      mult.current!.textContent = times && times > 1 ? `×${times}` : "";
      anim.current?.cancel();
      anim.current = el.animate(
        [{ opacity: 0, transform: "translate(-50%, -6px)" }, { opacity: 1, transform: "translate(-50%, 0)", offset: 0.12 }, { opacity: 1, transform: "translate(-50%, 0)", offset: 0.75 }, { opacity: 0, transform: "translate(-50%, 0)" }],
        { duration: 700, fill: "forwards" },
      );
    },
  }), []);

  return (
    <div className="popup" ref={root} role="status" aria-live="polite" data-kind="in">
      <span ref={icon} aria-hidden />
      <span ref={gender} className="pg" aria-hidden />
      <span ref={text} />
      <span ref={mult} className="pm" />
    </div>
  );
});
export default memo(Popup);
