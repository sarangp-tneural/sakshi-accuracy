import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./bits";

interface T { id: number; kind: "success" | "error" | "info"; text: string; action?: { label: string; run: () => void } }
interface Api {
  success: (text: string) => void;
  info: (text: string, action?: T["action"]) => void;
  error: (e: unknown) => void;
}
const Ctx = createContext<Api>(null!);
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const n = useRef(0);
  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const push = useCallback((kind: T["kind"], text: string, action?: T["action"]) => {
    const id = ++n.current;
    setItems((x) => [...x.slice(-3), { id, kind, text, action }]);
    setTimeout(() => dismiss(id), kind === "error" ? 8000 : action ? 6000 : 3500);
  }, [dismiss]);
  const api = useMemo<Api>(() => ({
    success: (t) => push("success", t),
    info: (t, a) => push("info", t, a),
    error: (e) => push("error", e instanceof Error ? e.message : String(e)),
  }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
            <span style={{ flex: 1 }}>{t.text}</span>
            {t.action && <Button size="sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</Button>}
            <Button size="sm" variant="ghost" aria-label="Dismiss" onClick={() => dismiss(t.id)}>✕</Button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
