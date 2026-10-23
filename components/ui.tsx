import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, subtitle, children, className = "" }: { title?: string; subtitle?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className}`}>
      {title && (
        <header className="mb-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Up/down value: color plus an arrow so sign never relies on color alone. */
export function Delta({ value, children }: { value: number; children: ReactNode }) {
  const cls = value > 0 ? "text-up" : value < 0 ? "text-down" : "text-ink-2";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return (
    <span className={`num ${cls}`}>
      {arrow && <span aria-hidden className="mr-0.5 text-[0.7em]">{arrow}</span>}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

const STATUS: Record<string, { dot: string; label: string }> = {
  ok: { dot: "bg-good", label: "OK" },
  closed: { dot: "bg-muted", label: "Market closed" },
  paused: { dot: "bg-warning", label: "Paused" },
  skipped: { dot: "bg-muted", label: "Skipped" },
  running: { dot: "bg-warning", label: "Running" },
  error: { dot: "bg-critical", label: "Error" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { dot: "bg-muted", label: status };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span aria-hidden className={`size-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "buy" ? "border-up/40 text-up" : action === "sell" ? "border-down/40 text-down" : "border-line text-muted";
  return <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase ${cls}`}>{action}</span>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="num w-full text-sm [&_td]:py-2 [&_td]:pr-4 [&_th]:pb-2 [&_th]:pr-4 [&_th]:text-left [&_th]:text-xs [&_th]:font-normal [&_th]:text-muted [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_td:last-child]:pr-0 [&_th:last-child]:pr-0">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export function Skeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl border border-line bg-surface ${className}`} />;
}
