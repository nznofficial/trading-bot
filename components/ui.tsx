import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="label mb-2 flex items-center gap-2 text-neon!">
          <span aria-hidden className="h-px w-6 bg-neon shadow-[0_0_6px_var(--neon)]" />
          {kicker}
        </div>
        <h1 className="glow-text font-display text-2xl font-bold tracking-[0.12em] uppercase">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

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
    <section className={`panel scan-in p-5 ${className}`}>
      {title && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-label text-[11px] tracking-[0.18em] text-ink uppercase">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Up/down value: gold for money made, red for money lost, plus an arrow so sign never relies on color. */
export function Delta({ value, children, glow = false }: { value: number; children: ReactNode; glow?: boolean }) {
  const cls = value > 0 ? `text-gold ${glow ? "glow-gold" : ""}` : value < 0 ? `text-loss ${glow ? "glow-loss" : ""}` : "text-ink-2";
  const arrow = value > 0 ? "▲" : value < 0 ? "▼" : "";
  return (
    <span className={`num ${cls}`}>
      {arrow && <span aria-hidden className="mr-1 text-[0.7em]">{arrow}</span>}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="panel scan-in p-4">
      <div className="label">{label}</div>
      <div className="num mt-2 text-2xl font-medium text-ink">{value}</div>
      {sub && <div className="mt-1.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Label/value pairs inside a panel. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="label text-[9px]!">{label}</dt>
      <dd className="num mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

const STATUS: Record<string, { dot: string; label: string; text: string }> = {
  ok: { dot: "bg-good text-good live-dot", label: "OK", text: "text-good" },
  closed: { dot: "bg-muted", label: "Closed", text: "text-ink-2" },
  paused: { dot: "bg-warning", label: "Paused", text: "text-warning" },
  skipped: { dot: "bg-muted", label: "Skipped", text: "text-ink-2" },
  running: { dot: "bg-warning text-warning live-dot", label: "Running", text: "text-warning" },
  error: { dot: "bg-critical", label: "Error", text: "text-loss" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { dot: "bg-muted", label: status, text: "text-ink-2" };
  return (
    <span className={`inline-flex items-center gap-2 font-label text-[10px] tracking-[0.16em] uppercase ${s.text}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "buy"
      ? "border-gold/50 bg-gold/10 text-gold"
      : action === "sell"
        ? "border-loss/50 bg-loss/10 text-loss"
        : "border-line text-muted";
  return (
    <span className={`inline-block rounded-sm border px-1.5 py-0.5 font-label text-[9px] tracking-[0.14em] uppercase ${cls}`}>
      {action}
    </span>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-sm [&_td]:py-2.5 [&_td]:pr-4 [&_td:last-child]:pr-0 [&_tbody_tr]:border-t [&_tbody_tr]:border-line/60 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-neon/[0.035] [&_th]:pr-4 [&_th]:pb-2.5 [&_th]:text-left [&_th]:font-label [&_th]:text-[9px] [&_th]:font-normal [&_th]:tracking-[0.16em] [&_th]:text-muted [&_th]:uppercase [&_th:last-child]:pr-0">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span aria-hidden className="h-px w-16 bg-gradient-to-r from-transparent via-neon/60 to-transparent" />
      <p className="text-sm text-muted">{children}</p>
    </div>
  );
}

export function Skeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`skeleton rounded-md border border-line ${className}`} />;
}

const CLASS_TABS = [
  { value: "all", label: "All" },
  { value: "us_equity", label: "Stocks" },
  { value: "crypto", label: "Crypto" },
] as const;

/** Asset-class filter as plain links (?class=…), so it works without client JS. */
export function ClassTabs({ path, active }: { path: string; active: string }) {
  return (
    <nav aria-label="Asset class" className="inline-flex w-fit gap-1 rounded-md border border-line bg-surface/80 p-1">
      {CLASS_TABS.map((t) => (
        <Link
          key={t.value}
          href={t.value === "all" ? path : `${path}?class=${t.value}`}
          aria-current={active === t.value ? "page" : undefined}
          className={`rounded-sm px-3.5 py-1.5 font-label text-[10px] tracking-[0.16em] uppercase transition-colors ${
            active === t.value
              ? "bg-neon/10 text-neon shadow-[inset_0_0_0_1px_var(--neon-strong)]"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
