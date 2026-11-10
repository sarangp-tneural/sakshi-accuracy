import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { DIRECTION_META, GENDER_META, type Direction, type Gender } from "../../lib/semantic";
import { keyLabel } from "../../keys/registry";

export function Button({ variant = "secondary", size, className = "", ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "lg" | "icon" }) {
  const v = variant === "secondary" ? "" : variant;
  return <button type="button" {...p} className={`btn ${v} ${size ?? ""} ${className}`.trim()} />;
}

export const Spinner = ({ label = "Loading" }: { label?: string }) => <span className="spinner" role="status" aria-label={label} />;

export function Keycap({ code }: { code: string }) { return <kbd className="keycap">{keyLabel(code)}</kbd>; }

export const DirBadge = ({ d }: { d: Direction }) => (
  <span className={`badge ${d}`}><span aria-hidden>{DIRECTION_META[d].icon}</span>{DIRECTION_META[d].label}</span>
);
export const GenderBadge = ({ g }: { g: Gender }) => (
  <span className={`badge ${g}`} title={GENDER_META[g].label}><span aria-hidden>{GENDER_META[g].icon}</span>{GENDER_META[g].short}</span>
);

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="err" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      {message} {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

/** Breadcrumb: links for the path, the last item is the current page (not a link). Long names are shortened with an ellipsis. */
export function Crumbs({ items }: { items: { label: string; to?: string; icon?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span className="crumb" key={i}>
          {i > 0 && <span className="sep" aria-hidden>›</span>}
          {it.to
            ? <Link to={it.to} title={it.label}>{it.icon && <span aria-hidden>{it.icon} </span>}{it.label}</Link>
            : <span className="here" aria-current="page" title={it.label}>{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}
