import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DrawdownChart, EquityChart, PerformanceChart } from "@/components/charts";
import { ART } from "@/components/art";
import { unitFor } from "@/components/emblems";
import { CueOnce } from "@/components/sound";
import { Card, Delta, Empty, Gauge, KeyValueList, PageHeader, Skeleton, StatStrip, StatusBadge, Table } from "@/components/ui";
import { classLabel, dateTime, duration, longDate, pct, qty, ratio, signedPct, signedUsd, usd } from "@/lib/format";
import { briefAttrs, positionBrief, tradeBrief } from "@/lib/briefings";
import { APP_SHORT } from "@/lib/config";
import { DAMAGE } from "@/lib/copilot";
import { getOverview } from "@/lib/queries";

export const metadata: Metadata = { title: { absolute: `${APP_SHORT} · Bridge` } };

export default function BridgePage() {
  return (
    <>
      <PageHeader
        code="SYS-01 // Bridge"
        title="Bridge"
        subtitle="Command overview · equities and crypto theaters"
        scene={ART.bridge}
        scenePosition="center 12%"
        brief={briefAttrs("page-bridge")}
      />
      <Suspense fallback={<BridgeSkeleton />}>
        <Bridge />
      </Suspense>
    </>
  );
}

function BridgeSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Skeleton className="h-[440px] lg:col-span-2" />
        <Skeleton className="h-[440px]" />
      </div>
      <Skeleton className="h-24" />
    </div>
  );
}

async function Bridge() {
  await connection(); // DB-backed: render at request time, never at build
  const o = await getOverview();
  if (!o.hasData || !o.kpis) {
    return (
      <Card>
        <Empty art={ART.coldLarge} cover position="50% 22%">Systems cold. The first sortie records a snapshot.</Empty>
      </Card>
    );
  }
  const k = o.kpis;
  const s = o.stats;
  const gain = k.equity - k.startEquity;
  const armor = 1 + k.currentDrawdown; // 100% at the equity peak
  const armorColor = armor >= 0.97 ? "var(--sync)" : armor >= 0.9 ? "var(--amber)" : "var(--alert)";
  const last = o.performance.at(-1);
  const classes = (["us_equity", "crypto"] as const).map((cls) => ({ cls, ...o.classes[cls] }));

  return (
    <div className="grid grid-cols-1 gap-5">
      {o.bigWin && <KoBanner trade={o.bigWin} />}
      {!o.bigWin && k.dayPnlPct <= DAMAGE.dayPct && <DamageBanner dayPnl={k.dayPnl} dayPnlPct={k.dayPnlPct} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Hero: frame value + equity curve */}
        <section
          className="frame frame-hot boot lg:col-span-2"
          tabIndex={0}
          {...briefAttrs("equity", {
            equity: usd(k.equity),
            day: signedUsd(k.dayPnl),
            dayPct: signedPct(k.dayPnlPct),
            dayRaw: k.dayPnlPct,
            total: signedUsd(gain),
            totalPct: signedPct(k.totalReturn),
          })}
        >
          <div className="frame-body flex flex-col">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-6 pt-5">
              <div>
                <div className="hud text-[12px] text-unit">Frame value · total equity</div>
                <div className="num mt-1 text-[40px] leading-none font-medium text-ink sm:text-[50px]">{usd(k.equity)}</div>
              </div>
              <dl className="flex gap-8 pb-1">
                <div>
                  <dt className="hud text-[11px] text-muted">Today</dt>
                  <dd className="mt-0.5 text-[16px]">
                    <Delta value={k.dayPnl}>{signedUsd(k.dayPnl)}</Delta>{" "}
                    <span className="text-[12px]">
                      <Delta value={k.dayPnlPct}>{signedPct(k.dayPnlPct)}</Delta>
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="hud text-[11px] text-muted">Since launch</dt>
                  <dd className="mt-0.5 text-[16px]">
                    <Delta value={gain}>{signedUsd(gain)}</Delta>{" "}
                    <span className="text-[12px]">
                      <Delta value={k.totalReturn}>{signedPct(k.totalReturn)}</Delta>
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
            <div className="relative mt-3 min-h-[280px] flex-1">
              <div className="absolute inset-0 px-2 pb-3">
                <EquityChart data={o.equity} height="100%" />
              </div>
            </div>
          </div>
        </section>

        {/* Frame status: gauges, combo, pilot readouts */}
        <Card
          title="Frame status"
          code="SYS-02"
          action={o.paused ? <StatusBadge status="paused" /> : o.lastRun && <StatusBadge status={o.lastRun.status} />}
          brief={briefAttrs("frame-status", {
            lastRun: o.lastRun ? dateTime(o.lastRun.startedAt) : null,
            status: o.paused ? "hold" : (o.lastRun?.status ?? null),
            paused: o.paused,
          })}
        >
          <div className="grid grid-cols-1 gap-4">
            <Gauge
              label="Armor integrity"
              value={armor}
              readout={pct(armor, 1)}
              color={armorColor}
              caption={`100% at peak · now ${pct(k.currentDrawdown)} drawdown`}
              brief={briefAttrs("armor", { value: pct(armor, 1), drawdown: pct(k.currentDrawdown) })}
            />
            <Gauge
              label="Sync rate"
              value={s.winRate ?? 0}
              readout={s.winRate === null ? "—" : pct(s.winRate, 0)}
              color="var(--unit)"
              caption={`Win rate · ${s.wins} won / ${s.losses} lost`}
              brief={briefAttrs("win-rate", {
                scope: "All units",
                value: s.winRate === null ? "—" : pct(s.winRate, 0),
                sub: `${s.wins} won, ${s.losses} lost`,
                count: s.count,
              })}
            />
            <Gauge
              label="Power output"
              value={k.exposure}
              readout={pct(k.exposure, 1)}
              color="var(--amber)"
              caption={`Capital deployed · ${k.openPositions} engagement${k.openPositions === 1 ? "" : "s"}`}
              brief={briefAttrs("exposure", { value: pct(k.exposure, 1), open: k.openPositions })}
            />
          </div>

          <div className="mt-5 flex items-center justify-between border-y border-line py-3" {...briefAttrs("streak", { value: o.streak })}>
            <span className="hud text-[12px] text-ink-2">Combo</span>
            <span className="flex items-baseline gap-2">
              <span className={`font-title text-[34px] leading-none font-extrabold ${o.streak > 0 ? "text-sync" : "text-muted"}`}>
                {o.streak}
              </span>
              <span className="hud text-[12px] text-muted">win streak</span>
            </span>
          </div>

          <div className="mt-4">
            <KeyValueList
              rows={[
                { label: "Cash reserves", value: usd(k.cash), brief: briefAttrs("cash", { value: usd(k.cash) }) },
                {
                  label: "Realized",
                  value: <Delta value={k.realizedPnl}>{signedUsd(k.realizedPnl)}</Delta>,
                  brief: briefAttrs("realized", { scope: "All units", value: signedUsd(k.realizedPnl) }),
                },
                {
                  label: "Unrealized",
                  value: <Delta value={k.unrealizedPnl}>{signedUsd(k.unrealizedPnl)}</Delta>,
                  brief: briefAttrs("unrealized", { scope: "All units", value: signedUsd(k.unrealizedPnl) }),
                },
                {
                  label: "Last sortie",
                  value: o.lastRun ? dateTime(o.lastRun.startedAt) : "—",
                  brief: briefAttrs("last-sortie", {
                    value: o.lastRun ? dateTime(o.lastRun.startedAt) : null,
                    status: o.lastRun?.status ?? null,
                  }),
                },
              ]}
            />
          </div>
          {o.lastRun?.error && <p className="mt-3 text-[13px] text-alert">{o.lastRun.error}</p>}
        </Card>
      </div>

      <StatStrip
        cols={6}
        items={[
          {
            label: "Max damage",
            value: pct(k.maxDrawdown),
            sub: "largest drawdown",
            brief: briefAttrs("max-drawdown", { value: pct(k.maxDrawdown) }),
          },
          {
            label: "Sharpe",
            value: ratio(k.sharpe),
            sub: `annualized · ${k.days}d`,
            brief: briefAttrs("sharpe", { value: ratio(k.sharpe), sub: `${k.days} day${k.days === 1 ? "" : "s"} of history`, days: k.days }),
          },
          { label: "Sortino", value: ratio(k.sortino), sub: "annualized", brief: briefAttrs("sortino", { value: ratio(k.sortino) }) },
          {
            label: "Engagements won",
            value: s.winRate === null ? "—" : pct(s.winRate, 0),
            sub: `${s.count} closed`,
            brief: briefAttrs("win-rate", {
              scope: "All units",
              value: s.winRate === null ? "—" : pct(s.winRate, 0),
              sub: `${s.wins} won, ${s.losses} lost`,
              count: s.count,
            }),
          },
          {
            label: "Profit factor",
            value: ratio(s.profitFactor),
            sub: "gross win ÷ loss",
            brief: briefAttrs("profit-factor", { scope: "All units", value: ratio(s.profitFactor), count: s.count }),
          },
          {
            label: "Expectancy",
            value: s.expectancy === null ? "—" : signedUsd(s.expectancy),
            sub: "per trade",
            brief: briefAttrs("expectancy", {
              scope: "All units",
              value: s.expectancy === null ? "—" : signedUsd(s.expectancy),
              sub: `over ${s.count} trades`,
              count: s.count,
            }),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card
          title="Versus"
          subtitle="Cumulative return · you vs SPY vs BTC"
          code="SYS-03"
          className="lg:col-span-2"
          brief={briefAttrs("versus", {
            you: last ? signedPct(last.portfolio) : null,
            spy: last?.spy == null ? null : signedPct(last.spy),
            btc: last?.btc == null ? null : signedPct(last.btc),
            youRaw: o.performance.length > 1 ? (last?.portfolio ?? null) : null,
            spyRaw: last?.spy ?? null,
          })}
        >
          {last && (
            <div className="mb-5 grid grid-cols-3 items-center gap-2 text-center">
              <VsSide label="You" value={last.portfolio} color="var(--series-1)" />
              <VsSide label="SPY" value={last.spy} color="var(--series-2)" />
              <VsSide label="BTC" value={last.btc} color="var(--series-3)" />
            </div>
          )}
          {o.performance.length > 1 ? (
            <PerformanceChart data={o.performance} />
          ) : (
            <Empty>The versus chart opens after two days of history.</Empty>
          )}
        </Card>
        <Card
          title="Damage report"
          subtitle="Drawdown from peak"
          code="SYS-04"
          brief={briefAttrs("drawdown-chart", { max: pct(k.maxDrawdown), current: pct(k.currentDrawdown) })}
        >
          <DrawdownChart data={o.drawdown} />
          <p className="mt-3 text-[13px] text-muted">
            Worst hit so far: <span className="num text-ink">{pct(k.maxDrawdown)}</span>
          </p>
        </Card>
      </div>

      <Card title="Theaters" subtitle="Allocation by asset class" code="SYS-05" brief={briefAttrs("theaters")}>
        <Table>
          <thead>
            <tr>
              <th>Theater</th>
              <th className="text-right!">Deployed</th>
              <th className="text-right!">Engagements</th>
              <th className="text-right!">Realized</th>
              <th className="text-right!">Unrealized</th>
              <th className="text-right!">Fees</th>
              <th className="text-right!">Won</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr
                key={c.cls}
                {...briefAttrs("theater", {
                  cls: c.cls,
                  label: classLabel(c.cls),
                  deployed: pct(k.equity ? c.exposure / k.equity : 0, 1),
                  open: c.openPositions,
                  realized: signedUsd(c.realized),
                  unrealized: signedUsd(c.unrealized),
                  fees: usd(c.fees),
                  won: c.winRate === null ? "—" : pct(c.winRate, 0),
                })}
              >
                <td className="whitespace-nowrap">
                  <span className="hud text-ink">{classLabel(c.cls)}</span>
                  <span className="ml-2 text-[12px] text-muted">{c.cls === "crypto" ? "BTC · ETH · SOL · 24/7" : "10 symbols · market hours"}</span>
                </td>
                <td className="num text-right">{pct(k.equity ? c.exposure / k.equity : 0, 1)}</td>
                <td className="num text-right">{c.openPositions}</td>
                <td className="num text-right">
                  <Delta value={c.realized}>{signedUsd(c.realized)}</Delta>
                </td>
                <td className="num text-right">
                  <Delta value={c.unrealized}>{signedUsd(c.unrealized)}</Delta>
                </td>
                <td className="num text-right text-ink-2">{c.cls === "crypto" ? usd(c.fees) : "—"}</td>
                <td className="num text-right">{c.winRate === null ? "—" : pct(c.winRate, 0)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card
        title="Active engagements"
        subtitle="Open positions"
        code="SYS-06"
        brief={briefAttrs("active-engagements", { count: o.positions.length })}
        action={
          <Link href="/positions" className="hud text-[12px] text-amber hover:underline">
            All →
          </Link>
        }
      >
        {o.positions.length ? (
          <Table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Unit</th>
                <th className="text-right!">Qty</th>
                <th className="text-right!">Price</th>
                <th className="text-right!">Value</th>
                <th className="text-right!">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {o.positions.map((p) => (
                <tr
                  key={p.symbol}
                  {...positionBrief(p)}
                >
                  <td className="num font-medium text-ink">{p.symbol}</td>
                  <td className="hud text-[12px] text-ink-2">{unitFor(p.strategy)?.code ?? "Manual"}</td>
                  <td className="num text-right">{qty(p.qty)}</td>
                  <td className="num text-right">{usd(p.currentPrice)}</td>
                  <td className="num text-right">{usd(p.marketValue)}</td>
                  <td className="num text-right whitespace-nowrap">
                    <Delta value={p.unrealizedPl}>
                      {signedUsd(p.unrealizedPl)} ({signedPct(p.unrealizedPlpc)})
                    </Delta>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty art={ART.noContactLarge} cover>All units holding position. Entries fire when a strategy locks on.</Empty>
        )}
      </Card>

      <Card
        title="Combat log"
        subtitle="Latest closed trades"
        code="SYS-07"
        brief={briefAttrs("recent-trades", { count: o.recentTrades.length })}
        action={
          <Link href="/trades" className="hud text-[12px] text-amber hover:underline">
            Full log →
          </Link>
        }
      >
        {o.recentTrades.length ? (
          <Table>
            <thead>
              <tr>
                <th>Closed</th>
                <th>Target</th>
                <th>Unit</th>
                <th className="text-right!">Entry → Exit</th>
                <th className="text-right!">Result</th>
                <th className="text-right!">Held</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {o.recentTrades.map((t, i) => (
                <tr key={i} {...tradeBrief(t)}>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="num font-medium text-ink">{t.symbol}</td>
                  <td className="hud text-[12px] text-ink-2">{unitFor(t.strategy)?.code ?? "Manual"}</td>
                  <td className="num text-right whitespace-nowrap">
                    {usd(t.entryPrice)} → {usd(t.exitPrice)}
                  </td>
                  <td className="num text-right">
                    <Delta value={t.pnl}>{signedUsd(t.pnl)}</Delta>
                  </td>
                  <td className="num text-right text-ink-2">{duration(t.holdMs)}</td>
                  <td className="text-right">
                    <Link
                      href={`/trades/debrief?entry=${t.entryOrderId}&exit=${t.exitOrderId}`}
                      className="hud text-[12px] whitespace-nowrap text-amber hover:underline"
                    >
                      Debrief ▸
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty art={ART.awaitingLarge} cover position="45% 10%">No engagements closed yet. Since launch {longDate(k.since)}.</Empty>
        )}
      </Card>
    </div>
  );
}

function VsSide({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="border border-line-2 bg-surface-2/60 px-2 py-2.5 slant">
      <div className="unslant">
        <div className="hud text-[12px]" style={{ color }}>
          {label}
        </div>
        <div className="num mt-0.5 text-[18px] text-ink">{value === null ? "—" : signedPct(value)}</div>
      </div>
    </div>
  );
}

/** "Target neutralized" banner for a big recent win (≥ 2% in the last 24h). */
function KoBanner({ trade }: { trade: { symbol: string; pnl: number; returnPct: number; exitTs: number } }) {
  return (
    <section
      className="frame frame-amber boot"
      role="status"
      {...briefAttrs("ko-banner", { symbol: trade.symbol, pnl: signedUsd(trade.pnl), ret: signedPct(trade.returnPct) })}
    >
      <CueOnce id={`${trade.symbol}-${trade.exitTs}`} cue="win" />
      <div className="frame-body relative overflow-hidden px-6 py-4">
        <Image src={ART.victory} alt="" fill sizes="(max-width: 1280px) 100vw, 1280px" className="object-cover object-[center_17%] opacity-60" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#08070c] via-[#08070c]/75 to-transparent" />
        <div className="hazard hazard-live absolute inset-y-0 left-0 w-3" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 py-4 pl-4">
          <span className="slam font-title text-[30px] leading-none font-extrabold text-amber sm:text-[38px]">
            Target neutralized
          </span>
          <span className="hud text-[15px] text-ink">
            <span className="num">{trade.symbol}</span> · <Delta value={trade.pnl}>{signedUsd(trade.pnl)}</Delta>{" "}
            <Delta value={trade.returnPct}>({signedPct(trade.returnPct)})</Delta>
          </span>
          <span className="num text-[12px] text-muted">{dateTime(trade.exitTs)}</span>
        </div>
      </div>
    </section>
  );
}

/** Red-day banner (day P&L ≤ −1%), the same threshold that puts JC-316 in its damaged state. */
function DamageBanner({ dayPnl, dayPnlPct }: { dayPnl: number; dayPnlPct: number }) {
  return (
    <section className="frame boot" role="status" {...briefAttrs("damage-banner", { pnl: signedUsd(dayPnl), pct: signedPct(dayPnlPct) })}>
      <div className="frame-body relative overflow-hidden px-6 py-4">
        <Image src={ART.damage} alt="" fill sizes="(max-width: 1280px) 100vw, 1280px" className="object-cover object-[center_40%] opacity-55" />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-[#08070c] via-[#08070c]/75 to-transparent" />
        <div className="relative flex flex-wrap items-center gap-x-6 gap-y-2 py-4">
          <span className="font-title text-[30px] leading-none font-extrabold text-alert sm:text-[38px]">Taking damage</span>
          <span className="hud text-[15px] text-ink">
            Day <Delta value={dayPnl}>{signedUsd(dayPnl)}</Delta> <Delta value={dayPnlPct}>({signedPct(dayPnlPct)})</Delta>
          </span>
          <span className="text-[13px] text-ink-2">Stops are armed; the −3% halt blocks new entries if it gets worse.</span>
        </div>
      </div>
    </section>
  );
}
