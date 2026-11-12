import { useEffect, useRef, type ReactNode } from "react";
import { capture } from "../../keys/capture";
import { Button } from "./bits";

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers pass inline arrows (a new function every render). Keep the latest in a ref so the effect below runs
  // only when the dialog opens/closes; otherwise every keystroke re-ran it and moved focus to the close button.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (root?.querySelector<HTMLElement>("input:not(:disabled), textarea:not(:disabled), select:not(:disabled)")
      ?? root?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !capture.active) { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="row"><h2>{title}</h2><span className="spacer" /><Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}>✕</Button></div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = "Confirm", danger, onConfirm, onCancel }:
  { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p style={{ margin: 0 }}>{message}</p>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
