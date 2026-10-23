import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Panel with an optional hairline-divided header. Tables inside bleed to the panel edges. */
export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel rise flex flex-col overflow-hidden ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="shrink-0 text-[13px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

/** Up/down value: gold for money made, red for money lost, plus an arrow so sign never relies on color. */
export function Delta({ value, children }: { value: number; children: ReactNode }) {
  const cls = value > 0 ? "text-gold" : value < 0 ? "text-loss" : "text-ink-2";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return (
    <span className={`num ${cls}`}>
      {arrow && <span aria-hidden className="mr-1 text-[0.72em]">{arrow}</span>}
      {children}
    </span>
  );
}

export type StatItem = { label: string; value: ReactNode; sub?: ReactNode };

/** A row of metrics in one panel, separated by hairlines (the gap-px trick paints the dividers). */
export function StatStrip({ items, cols = 4 }: { items: StatItem[]; cols?: 3 | 4 | 6 }) {
  const grid = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 6: "md:grid-cols-3 xl:grid-cols-6" }[cols];
  return (
    <div className={`panel rise grid grid-cols-2 gap-px overflow-hidden bg-line ${grid}`}>
      {items.map((s) => (
        <div key={s.label} className="bg-surface px-5 py-4">
          <div className="label">{s.label}</div>
          <div className="num mt-1.5 text-[19px] text-ink">{s.value}</div>
          {s.sub && <div className="mt-1 truncate text-xs text-muted">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Label/value pair for small grids inside a panel. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="num mt-1 text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** Label-left, value-right rows with hairlines — for account summaries. */
export function KeyValueList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-[13px] text-ink-2">{r.label}</dt>
          <dd className="num text-[13px] text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS: Record<string, { dot: string; label: string }> = {
  ok: { dot: "bg-good", label: "OK" },
  closed: { dot: "bg-muted", label: "Market closed" },
  paused: { dot: "bg-warning", label: "Paused" },
  skipped: { dot: "bg-muted", label: "Skipped" },
  running: { dot: "bg-warning", label: "Running" },
  error: { dot: "bg-loss", label: "Error" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { dot: "bg-muted", label: status };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
      <span aria-hidden className={`size-1.5 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "buy"
      ? "bg-gold/12 text-gold"
      : action === "sell"
        ? "bg-loss/12 text-loss"
        : "bg-surface-2 text-muted";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide uppercase ${cls}`}>
      {action}
    </span>
  );
}

/** Small neutral tag, e.g. a symbol chip or asset class. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded border border-line-2 px-1.5 py-px text-[11px] text-ink-2">{children}</span>
  );
}

/** Data table that bleeds to the panel edges; numeric cells should use `num text-right`. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full text-[13px] [&_td]:px-3 [&_td]:py-2.5 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-2/60 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:tracking-[0.06em] [&_th]:text-muted [&_th]:uppercase [&_th:first-child]:pl-5 [&_th:last-child]:pr-5 [&_thead]:bg-surface-2/50">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-muted">{children}</p>;
}

export function Skeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`skeleton rounded-[10px] border border-line ${className}`} />;
}

const CLASS_TABS = [
  { value: "all", label: "All" },
  { value: "us_equity", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
] as const;

/** Asset-class filter as plain links (?class=…), so it works without client JS. */
export function ClassTabs({ path, active }: { path: string; active: string }) {
  return (
    <nav aria-label="Asset class" className="inline-flex w-fit rounded-lg border border-line bg-surface p-0.5">
      {CLASS_TABS.map((t) => (
        <Link
          key={t.value}
          href={t.value === "all" ? path : `${path}?class=${t.value}`}
          aria-current={active === t.value ? "page" : undefined}
          className={`rounded-md px-3 py-1 text-[13px] font-medium transition-colors ${
            active === t.value ? "bg-surface-2 text-ink shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-muted hover:text-ink-2"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
