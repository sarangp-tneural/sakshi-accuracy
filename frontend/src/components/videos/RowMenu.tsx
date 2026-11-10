import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface MenuItem { label: string; onSelect: () => void; danger?: boolean }

/** "⋯" menu. Opens as a fixed popover (so the table's scroll area never clips it), arrow keys move, Esc closes and returns focus. */
export default function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom > 120;
    setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - items.length * 38), right: Math.max(8, window.innerWidth - r.right) });
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => { if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); els[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); els[els.length - 1]?.focus(); }
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <>
      <button ref={btn} type="button" className="btn sm ghost menubtn" aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}>⋯</button>
      {open && (
        <div ref={list} className="menu" role="menu" aria-label={label} style={{ top: pos.top, right: pos.right }} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.label} type="button" role="menuitem" className={it.danger ? "danger" : undefined}
              onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
