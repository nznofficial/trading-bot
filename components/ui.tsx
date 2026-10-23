import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyArt, SceneBanner } from "@/components/art";

/** Title card: system code, oversized serif title, HUD subtitle. */
export function PageHeader({
  code,
  title,
  subtitle,
  children,
  scene,
  figure,
  scenePosition,
}: {
  code: string;
  title: string;
  subtitle?: ReactNode;
  children?: ReactNode;
  /** Painted backdrop (public/art) behind the title. */
  scene?: string;
  /** Character standing on the right of the backdrop. */
  figure?: { src: string; alt: string };
  /** CSS object-position for the backdrop crop (e.g. "center 20%" to keep heads in frame). */
  scenePosition?: string;
}) {
  const content = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="hud flex items-center gap-3 text-[12px] text-amber">
          <span className="hazard inline-block h-3 w-8" aria-hidden />
          {code}
        </div>
        <h1 className="mt-2 font-title text-[38px] leading-none font-extrabold tracking-tight text-ink sm:text-[46px]">
          {title}
        </h1>
        {subtitle && <p className="hud mt-2 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
  if (scene) {
    return (
      <SceneBanner src={scene} figure={figure} position={scenePosition}>
        {content}
      </SceneBanner>
    );
  }
  return <div className="boot mb-7">{content}</div>;
}

/** Chamfered cockpit panel with a HUD header. `tone` lights the frame. */
export function Card({
  title,
  code,
  subtitle,
  action,
  tone,
  children,
  className = "",
}: {
  title?: string;
  code?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  tone?: "hot" | "amber";
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`frame boot ${tone === "hot" ? "frame-hot" : tone === "amber" ? "frame-amber" : ""} ${className}`}>
      <div className="frame-body flex flex-col">
        {title && (
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="h-4 w-1.5 shrink-0 bg-amber" />
              <h2 className="hud truncate text-[15px] text-ink">{title}</h2>
              {subtitle && <span className="hud hidden truncate text-[11px] text-muted sm:inline">{subtitle}</span>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {action}
              {code && <span className="hud text-[11px] text-muted">{code}</span>}
            </div>
          </header>
        )}
        <div className="flex-1 p-5">{children}</div>
      </div>
    </section>
  );
}

/** Signed value: sync green for gains, alert red for damage. The sign is always printed. */
export function Delta({ value, children }: { value: number; children: ReactNode }) {
  const cls = value > 0 ? "text-gain" : value < 0 ? "text-loss" : "text-ink-2";
  return <span className={`num ${cls}`}>{children}</span>;
}

/** Segmented gauge, 0–1. Color by role, optional readout on the right. */
export function Gauge({
  label,
  value,
  readout,
  color = "var(--sync)",
  caption,
}: {
  label: string;
  value: number;
  readout: ReactNode;
  color?: string;
  caption?: ReactNode;
}) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="hud text-[12px] text-ink-2">{label}</span>
        <span className="num text-[15px] text-ink">{readout}</span>
      </div>
      <div className="relative mt-1.5 h-3 overflow-hidden bg-[#1c1927] slant">
        <div className="gauge-fill h-full" style={{ width: `${v * 100}%`, background: color, boxShadow: `0 0 12px ${color}` }} />
        <div className="segments absolute inset-0" aria-hidden />
      </div>
      {caption && <div className="mt-1 text-[12px] text-muted">{caption}</div>}
    </div>
  );
}

export type StatItem = { label: string; value: ReactNode; sub?: ReactNode };

/** Readout strip: values in a single chamfered frame, separated by hairlines. */
export function StatStrip({ items, cols = 4 }: { items: StatItem[]; cols?: 3 | 4 | 6 }) {
  const grid = { 3: "md:grid-cols-3", 4: "md:grid-cols-4", 6: "md:grid-cols-3 xl:grid-cols-6" }[cols];
  return (
    <div className="frame boot">
      <div className={`frame-body grid grid-cols-2 gap-px bg-line ${grid}`}>
        {items.map((s) => (
          <div key={s.label} className="bg-surface px-5 py-4">
            <div className="hud text-[11px] text-muted">{s.label}</div>
            <div className="num mt-1 text-[22px] leading-tight text-ink">{s.value}</div>
            {s.sub && <div className="mt-0.5 truncate text-[12px] text-muted">{s.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Label/value pair for compact grids. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="hud text-[11px] text-muted">{label}</dt>
      <dd className="num mt-0.5 text-[15px] text-ink">{children}</dd>
    </div>
  );
}

/** System readout rows. */
export function KeyValueList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="hud text-[13px] text-ink-2">{r.label}</dt>
          <dd className="num text-[14px] text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const STATUS: Record<string, { cls: string; label: string }> = {
  ok: { cls: "text-sync border-sync/50 bg-sync/10", label: "Nominal" },
  closed: { cls: "text-ink-2 border-line-2 bg-surface-2", label: "Standby" },
  paused: { cls: "text-amber border-amber/50 bg-amber/10", label: "Hold" },
  skipped: { cls: "text-ink-2 border-line-2 bg-surface-2", label: "Skipped" },
  running: { cls: "text-amber border-amber/50 bg-amber/10", label: "Active" },
  error: { cls: "text-alert border-alert/60 bg-alert/10", label: "Abort" },
  config: { cls: "text-cyan border-cyan/50 bg-cyan/10", label: "Retuned" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS[status] ?? { cls: "text-ink-2 border-line-2", label: status };
  return (
    <span className={`hud inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] ${s.cls}`}>
      <span aria-hidden className={`size-1.5 bg-current ${status === "ok" || status === "running" ? "blink" : ""}`} />
      {label ?? s.label}
    </span>
  );
}

export function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "buy"
      ? "bg-sync text-[#0b0a10]"
      : action === "sell"
        ? "bg-alert text-white"
        : "border border-line-2 text-muted";
  return <span className={`hud inline-block px-2 py-0.5 text-[11px] ${cls}`}>{action}</span>;
}

/** Small tag (e.g. a symbol chip on a unit card). */
export function Tag({ children }: { children: ReactNode }) {
  return <span className="num inline-block border border-line-2 px-1.5 py-px text-[11px] text-ink-2">{children}</span>;
}

/** HUD data table that bleeds to the frame edges; numeric cells use `num text-right`. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full text-[14px] [&_td]:px-3 [&_td]:py-2.5 [&_td:first-child]:pl-5 [&_td:last-child]:pr-5 [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:first-child]:border-t-0 [&_tbody_tr:hover]:bg-unit/[0.07] [&_th]:border-b [&_th]:border-line-2 [&_th]:bg-[#120f1b] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-hud [&_th]:text-[12px] [&_th]:font-semibold [&_th]:tracking-[0.12em] [&_th]:text-amber/85 [&_th]:uppercase [&_th:first-child]:pl-5 [&_th:last-child]:pr-5">
        {children}
      </table>
    </div>
  );
}

export function Empty({ children, art }: { children: ReactNode; art?: string }) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 py-6 text-center">
      {art && <EmptyArt src={art} />}
      <span className="hud text-[12px] text-amber/80">— No contact —</span>
      <p className="text-[14px] text-muted">{children}</p>
    </div>
  );
}

export function Skeleton({ className = "h-64" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

const CLASS_TABS = [
  { value: "all", label: "All theaters" },
  { value: "us_equity", label: "Equities" },
  { value: "crypto", label: "Crypto" },
] as const;

/** Asset-class filter as plain links (?class=…), so it works without client JS. */
export function ClassTabs({ path, active }: { path: string; active: string }) {
  return (
    <nav aria-label="Asset class" className="flex w-fit gap-1.5">
      {CLASS_TABS.map((t) => (
        <Link
          key={t.value}
          href={t.value === "all" ? path : `${path}?class=${t.value}`}
          aria-current={active === t.value ? "page" : undefined}
          className={`hud slant border px-4 py-1.5 text-[13px] transition-colors ${
            active === t.value
              ? "border-unit bg-unit text-white shadow-[0_0_16px_rgba(139,92,246,0.5)]"
              : "border-line-2 text-ink-2 hover:border-unit/60 hover:text-ink"
          }`}
        >
          <span className="unslant inline-block">{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}
