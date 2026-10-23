import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-serif text-[30px] leading-tight font-semibold tracking-[-0.01em] text-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** White section panel with a ruled header. Tables inside bleed to the panel edges. */
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
    <section className={`panel flex flex-col overflow-hidden ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-[17px] font-semibold text-ink">{title}</h2>
            {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="flex-1 p-5">{children}</div>
    </section>
  );
}

/** Signed value in gain green / loss red. The sign is always printed, so color is never the only cue. */
export function Delta({ value, children }: { value: number; children: ReactNode }) {
  const cls = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-ink";
  return <span className={`num ${cls}`}>{children}</span>;
}

export type StatItem = { label: string; value: ReactNode; sub?: ReactNode };

/** Metrics in one panel separated by hairline rules (gap-px over a line-colored background). */
export function StatStrip({ items, cols = 4 }: { items: StatItem[]; cols?: 3 | 4 | 6 }) {
  const grid = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 6: "md:grid-cols-3 xl:grid-cols-6" }[cols];
  return (
    <div className={`panel grid grid-cols-2 gap-px overflow-hidden bg-line ${grid}`}>
      {items.map((s) => (
        <div key={s.label} className="bg-surface px-5 py-4">
          <div className="text-[13px] text-muted">{s.label}</div>
          <div className="num mt-1 text-[22px] leading-tight font-semibold text-ink">{s.value}</div>
          {s.sub && <div className="mt-0.5 truncate text-[12px] text-muted">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Label/value pair for compact grids inside a panel. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[15px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** Label-left, value-right ruled rows, as on a statement. */
export function KeyValueList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-[14px] text-ink-2">{r.label}</dt>
          <dd className="num text-[14px] font-semibold text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS: Record<string, { dot: string; label: string }> = {
  ok: { dot: "bg-gain", label: "Completed" },
  closed: { dot: "bg-line-2", label: "Market closed" },
  paused: { dot: "bg-warning", label: "Paused" },
  skipped: { dot: "bg-line-2", label: "Skipped" },
  running: { dot: "bg-warning", label: "Running" },
  error: { dot: "bg-loss", label: "Failed" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { dot: "bg-line-2", label: status };
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2">
      <span aria-hidden className={`size-2 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const cls = action === "buy" ? "text-gain" : action === "sell" ? "text-loss" : "text-muted";
  return <span className={`text-[13px] font-semibold capitalize ${cls}`}>{action}</span>;
}

/** Small neutral tag, e.g. a symbol chip. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-sm bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2 ring-1 ring-line">
      {children}
    </span>
  );
}

/** Statement-style data table that bleeds to the panel edges; numeric cells use `num text-right`. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full text-[14px] [&_td]:px-3 [&_td]:py-3 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:hover]:bg-[#f7f9fc] [&_th]:border-b [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-3 [&_th]:py-2.5 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-semibold [&_th]:text-ink-2 [&_th:first-child]:pl-5 [&_th:last-child]:pr-5 [&_tbody_tr:first-child]:border-t-0">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center py-6 text-center text-[14px] text-muted">
      <p>{children}</p>
    </div>
  );
}

export function Skeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />;
}

const CLASS_TABS = [
  { value: "all", label: "All" },
  { value: "us_equity", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
] as const;

/** Asset-class filter as plain links (?class=…), so it works without client JS. */
export function ClassTabs({ path, active }: { path: string; active: string }) {
  return (
    <nav aria-label="Asset class" className="inline-flex w-fit overflow-hidden rounded border border-line-2 bg-white">
      {CLASS_TABS.map((t, i) => (
        <Link
          key={t.value}
          href={t.value === "all" ? path : `${path}?class=${t.value}`}
          aria-current={active === t.value ? "page" : undefined}
          className={`px-4 py-1.5 text-[14px] transition-colors ${i > 0 ? "border-l border-line-2" : ""} ${
            active === t.value ? "bg-navy font-semibold text-white" : "text-ink-2 hover:bg-surface-2"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
