import { forwardRef, memo, useImperativeHandle, useRef } from "react";

export interface PopupHandle {
  /** kind picks the default colour (in / out / mark = no direction / undo); `color` overrides it with the marking's own. */
  show: (p: { kind: "in" | "out" | "mark" | "undo"; text: string; color?: string; times?: number }) => void;
}

/** Imperative on purpose: a key press writes straight to the DOM, no React render in the hot path. */
const Popup = forwardRef<PopupHandle>(function Popup(_, ref) {
  const root = useRef<HTMLDivElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const mult = useRef<HTMLSpanElement>(null);
  const anim = useRef<Animation | null>(null);

  useImperativeHandle(ref, () => ({
    show({ kind, text: t, color, times }) {
      const el = root.current; if (!el) return;
      el.dataset.kind = kind;
      el.style.color = kind !== "undo" && color ? color : "";
      icon.current!.textContent = kind === "in" ? "▲" : kind === "out" ? "▼" : kind === "mark" ? "●" : "↶";
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
      <span ref={text} />
      <span ref={mult} className="pm" />
    </div>
  );
});
export default memo(Popup);
