import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ART } from "@/components/art";
import { UNITS, unitFor } from "@/components/emblems";
import { Pager, PAGE_SIZES, readPaging, SizePicker, type PageHref } from "@/components/pager";
import { Card, Delta, Empty, PageHeader, Skeleton, StatStrip } from "@/components/ui";
import { briefAttrs } from "@/lib/briefings";
import { dateTime, pct, qty, signedPct, signedUsd } from "@/lib/format";
import { getIntel, WIRE_MATERIAL, type WireItem, type WireScore } from "@/lib/queries";

export const metadata: Metadata = { title: "Intel" };

export default function IntelPage({ searchParams }: PageProps<"/intel">) {
  return (
    <>
      <PageHeader
        code="SYS-07 // Intel"
        title="Intel"
        subtitle="Incoming wire · every headline scored for the targets it names"
        brief={briefAttrs("page-intel")}
      />
      <Suspense fallback={<Skeleton />}>
        <Intel searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const fmtSent = (s: number) => `${s > 0 ? "+" : s < 0 ? "−" : ""}${Math.abs(s).toFixed(1)}`;
const arrow = (s: number) => (s >= 0.2 ? "▲" : s <= -0.2 ? "▼" : "·");
const CATEGORY: Record<string, string> = {
  earnings: "Earnings",
  guidance: "Guidance",
  analyst: "Analyst",
  legal_regulatory: "Legal / regulatory",
  mna: "M&A",
  product: "Product",
  macro: "Macro",
  other: "Other",
};
const HERALD_UNIT = UNITS.news_drift;
const unitCode = (unit: string | null) => unitFor(unit)?.code ?? "—";

async function Intel({ searchParams }: { searchParams: PageProps<"/intel">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const sp = await searchParams;
  const { page, size } = readPaging(sp.page, sp.size ?? String(PAGE_SIZES[1]));
  const materialOnly = sp.view === "material";
  const intel = await getIntel(page, size, materialOnly);
  const { live, stats } = intel;
  const href: PageHref = (p, s) => `/intel?${new URLSearchParams({ ...(materialOnly ? { view: "material" } : {}), page: String(p), size: String(s) })}`;
  const gate = live.news.gateEnabled ? "Armed" : "Safed";
  const herald = live.herald.enabled ? "Armed" : "Safed";
  const newest = stats.cursor ? dateTime(stats.cursor) : null;

  return (
    <div className="grid grid-cols-1 gap-4">
      <StatStrip
        cols={4}
        items={[
          {
            label: "Headlines 24h",
            value: stats.last24h.toLocaleString(),
            sub: newest ? `newest ${newest}` : "awaiting first sync",
            brief: briefAttrs("intel-headlines", { count: stats.last24h, newest }),
          },
          {
            label: "Scored 24h",
            value: stats.scored24h.toLocaleString(),
            sub: "headline × target pairs",
            brief: briefAttrs("intel-scored", { count: stats.scored24h }),
          },
          {
            label: "News gate",
            value: <span className={live.news.gateEnabled ? "text-sync" : "text-muted"}>{gate}</span>,
            sub: `${stats.activeBlocks} active block${stats.activeBlocks === 1 ? "" : "s"}`,
            brief: briefAttrs("intel-gate", {
              status: gate,
              blocks: stats.activeBlocks,
              sentiment: fmtSent(live.news.vetoSentiment),
              materiality: live.news.minMateriality.toFixed(1),
              hours: live.news.vetoHours,
              tighten: pct(live.news.tightenPct, 1),
            }),
          },
          {
            label: "UNIT-03 Herald",
            value: <span className={live.herald.enabled ? "text-sync" : "text-amber"}>{herald}</span>,
            sub: live.herald.enabled ? `${pct(live.herald.pct, 0)} slice` : "awaiting backtest clearance",
            brief: briefAttrs("intel-herald", {
              status: herald,
              share: pct(live.herald.pct, 0),
              sentiment: fmtSent(live.herald.entrySentiment),
              materiality: live.herald.minMateriality.toFixed(1),
              days: live.herald.holdDays,
            }),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title="Incoming wire"
          code="INT-01"
          subtitle={`${intel.total.toLocaleString()} ${materialOnly ? "material " : ""}headlines · newest first`}
          brief={briefAttrs("intel-wire", { count: intel.total, view: materialOnly ? "material" : "all" })}
          action={
            <div className="flex items-center gap-3">
              <WireTabs materialOnly={materialOnly} size={size} />
              <div className="hidden sm:block">
                <SizePicker size={size} href={href} label="Headlines per page" />
              </div>
            </div>
          }
        >
          {intel.wire.length ? (
            <>
              <ol className="-mx-5 -my-5 divide-y divide-line">
                {intel.wire.map((w) => (
                  <WireRow key={w.id} item={w} />
                ))}
              </ol>
              <div className="mt-8">
                <Pager page={page} pages={intel.pages} size={size} href={href} label="Wire pages" />
              </div>
            </>
          ) : (
            <Empty art={ART.awaiting}>
              {materialOnly ? "No material headlines yet." : "The wire is quiet. Headlines arrive with each sortie."}
            </Empty>
          )}
        </Card>

        {/* On phones the blocks and log come before the long wire. */}
        <div className="order-first grid grid-cols-1 content-start gap-4 lg:order-none">
          <Card
            title="Active blocks"
            code="INT-02"
            tone={intel.blocks.length ? "hot" : undefined}
            brief={briefAttrs("intel-blocks", { count: intel.blocks.length, hours: live.news.vetoHours })}
          >
            {intel.blocks.length ? (
              <ul className="-mx-5 -my-5 divide-y divide-line">
                {intel.blocks.map((b) => (
                  <li
                    key={b.symbol}
                    className="relative px-5 py-3 pl-7"
                    {...briefAttrs("intel-block", {
                      symbol: b.symbol,
                      unit: b.unit,
                      unitCode: unitCode(b.unit),
                      sentiment: fmtSent(b.sentiment),
                      headline: b.headline,
                      until: dateTime(b.expiresAt),
                      tighten: pct(live.news.tightenPct, 1),
                    })}
                  >
                    <span aria-hidden className="hazard absolute inset-y-0 left-0 w-2" />
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="num text-[15px] font-medium text-ink">{b.symbol}</span>
                      <span className="num text-[13px] text-loss">
                        {arrow(b.sentiment)} {fmtSent(b.sentiment)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[13px] text-ink-2">{b.headline}</p>
                    <div className="hud mt-1 text-[11px] text-muted">
                      {unitCode(b.unit)} buys blocked · until {dateTime(b.expiresAt)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">
                {live.news.gateEnabled ? "No targets blocked. Every unit is clear to engage." : "Gate safed: news blocks nothing."}
              </p>
            )}
          </Card>

          <section
            className={`frame boot ${live.herald.enabled ? "" : "frame-amber"}`}
            tabIndex={0}
            {...briefAttrs("intel-herald-sorties", { status: herald, count: intel.heraldPositions.length, days: live.herald.holdDays })}
          >
            <div className="frame-body relative overflow-hidden">
              {/* Unit key art, faded behind the roster */}
              <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-2/3">
                <Image src={ART.heraldKeyart} alt="" fill sizes="260px" className="object-cover object-[center_15%] opacity-20" />
                <div className="absolute inset-0 bg-gradient-to-r from-[#0e0d14] to-transparent" />
              </div>
              <div aria-hidden className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${HERALD_UNIT.primary}, ${HERALD_UNIT.secondary})` }} />
              <div className="relative p-5">
                <div className="flex items-center gap-4">
                  <div className="relative size-20 shrink-0" style={{ filter: `drop-shadow(0 0 12px ${HERALD_UNIT.primary}88)` }}>
                    <Image src={ART.heraldBust} alt={`${HERALD_UNIT.code} ${HERALD_UNIT.callsign}`} fill sizes="80px" className="object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="hud text-[11px]" style={{ color: HERALD_UNIT.primary }}>
                      {HERALD_UNIT.code} · {HERALD_UNIT.role}
                    </div>
                    <h2 className="mt-0.5 font-title text-[26px] leading-none font-extrabold text-ink">{HERALD_UNIT.callsign}</h2>
                    <div className="hud mt-1 text-[12px] text-ink-2">
                      {live.herald.enabled ? `${pct(live.herald.pct, 0)} slice · hold ${live.herald.holdDays}d` : "Safed"}
                    </div>
                  </div>
                </div>
                {intel.heraldPositions.length ? (
                  <ul className="mt-4 divide-y divide-line border-t border-line">
                    {intel.heraldPositions.map((p) => (
                      <li key={p.symbol} className="flex items-baseline justify-between gap-3 py-2.5">
                        <span className="num text-[15px] font-medium text-ink">{p.symbol}</span>
                        <span className="num text-[13px] text-ink-2">{qty(p.qty)} sh</span>
                        <Delta value={p.unrealizedPl}>
                          {signedUsd(p.unrealizedPl)} <span className="text-xs">({signedPct(p.unrealizedPlpc)})</span>
                        </Delta>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 max-w-[30ch] text-[14px] text-muted">
                    {live.herald.enabled
                      ? "No news trades open. Herald engages on the next strongly positive, material headline."
                      : "Herald is safed until a train/test backtest shows it beats holding cash. Its headlines are still scored here."}
                  </p>
                )}
              </div>
            </div>
          </section>

          <Card title="Gate log" code="INT-04" brief={briefAttrs("intel-log", { count: intel.log.length })}>
            {intel.log.length ? (
              <ul className="-mx-5 -my-5 divide-y divide-line">
                {intel.log.map((l, i) => (
                  <li key={`${l.ts}-${l.symbol}-${l.kind}-${i}`} className="px-5 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="hud text-[12px] text-ink">
                        <span className={l.kind === "skip" ? "text-amber" : "text-alert"}>{LOG_LABEL[l.kind] ?? l.kind}</span>{" "}
                        <span className="num">{l.symbol}</span>
                      </span>
                      <span className="num text-[11px] text-muted">{dateTime(l.ts)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-2">
                      {unitCode(l.unit)} · {l.detail}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">Nothing logged yet. Every block, tightened stop and skipped buy lands here.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

const LOG_LABEL: Record<string, string> = {
  veto: "Veto",
  tighten: "Stop lifted",
  skip: "Buy skipped",
  herald_entry: "Herald buy",
  herald_exit: "Herald exit",
};

function WireTabs({ materialOnly, size }: { materialOnly: boolean; size: number }) {
  const tab = (active: boolean) =>
    `hud border px-2 py-0.5 text-[11px] ${active ? "border-unit bg-unit text-white" : "border-line-2 text-ink-2 hover:border-unit/60 hover:text-ink"}`;
  return (
    <nav aria-label="Wire filter" className="flex items-center gap-1">
      <Link href={`/intel?size=${size}`} scroll={false} aria-current={!materialOnly ? "page" : undefined} className={tab(!materialOnly)}>
        All
      </Link>
      <Link href={`/intel?view=material&size=${size}`} scroll={false} aria-current={materialOnly ? "page" : undefined} className={tab(materialOnly)}>
        Material
      </Link>
    </nav>
  );
}

function ScoreChip({ s, item }: { s: WireScore; item: WireItem }) {
  const tone = s.sentiment >= 0.2 ? "text-gain" : s.sentiment <= -0.2 ? "text-loss" : "text-ink-2";
  return (
    <span
      className="inline-flex items-center gap-2 border border-line-2 bg-surface-2 px-2 py-0.5"
      {...briefAttrs("intel-score", {
        symbol: s.symbol,
        sentiment: fmtSent(s.sentiment),
        materiality: s.materiality.toFixed(1),
        category: CATEGORY[s.category] ?? s.category,
        rationale: s.rationale,
        headline: item.headline,
        material: s.materiality >= WIRE_MATERIAL,
      })}
    >
      <span className="num text-[12px] font-medium text-ink">{s.symbol}</span>
      <span className={`num text-[12px] ${tone}`}>
        {arrow(s.sentiment)}
        {fmtSent(s.sentiment)}
      </span>
      <span className="flex items-center gap-1" title={`materiality ${s.materiality.toFixed(2)}`}>
        <span className="hud text-[10px] text-muted">MAT</span>
        <span className="relative h-2 w-10 overflow-hidden bg-[#1c1927]" aria-hidden>
          <span className="absolute inset-y-0 left-0 bg-amber" style={{ width: `${Math.round(s.materiality * 100)}%` }} />
          <span className="segments absolute inset-0" />
        </span>
      </span>
    </span>
  );
}

function WireRow({ item }: { item: WireItem }) {
  const top = item.scores[0];
  return (
    <li
      className="px-5 py-3 hover:bg-unit/[0.05]"
      {...briefAttrs("intel-headline", {
        headline: item.headline,
        source: item.source,
        time: dateTime(item.createdAt),
        targets: item.scores.map((s) => `${s.symbol} ${fmtSent(s.sentiment)}`).join(", ") || null,
        rationale: top?.rationale ?? null,
        actions: item.actions.length,
      })}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num text-[12px] text-muted">{dateTime(item.createdAt)}</span>
        <span className="hud text-[11px] text-muted">{item.source}</span>
      </div>
      <p className="mt-1 text-[15px] leading-snug text-ink">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer noopener" className="hover:text-amber">
            {item.headline}
          </a>
        ) : (
          item.headline
        )}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.scores.length ? (
          item.scores.map((s) => <ScoreChip key={s.symbol} s={s} item={item} />)
        ) : (
          <span className="hud text-[11px] text-amber/80 blink">Scoring…</span>
        )}
      </div>
      {item.actions.map((a) => (
        <div key={`${a.kind}-${a.symbol}`} className="hud mt-1.5 text-[12px] text-alert">
          → {LOG_LABEL[a.kind] ?? a.kind}: <span className="num">{a.symbol}</span> · {unitCode(a.unit)}
        </div>
      ))}
    </li>
  );
}
