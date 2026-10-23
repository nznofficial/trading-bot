import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DrawdownChart, EquityChart, PerformanceChart } from "@/components/charts";
import {
  Card,
  Delta,
  Empty,
  KeyValueList,
  PageHeader,
  Skeleton,
  StatStrip,
  StatusBadge,
  Table,
} from "@/components/ui";
import {
  classLabel,
  dateTime,
  duration,
  longDate,
  pct,
  ratio,
  signedPct,
  signedUsd,
  strategyLabel,
  usd,
} from "@/lib/format";
import { getOverview } from "@/lib/queries";

export default function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" subtitle="Performance, risk and bot health across stocks and crypto." />
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[420px] lg:col-span-2" />
        <Skeleton className="h-[420px]" />
      </div>
      <Skeleton className="h-24" />
    </div>
  );
}

async function Overview() {
  await connection(); // DB-backed: render at request time, never at build
  const o = await getOverview();
  if (!o.hasData || !o.kpis) {
    return (
      <Card>
        <Empty>No data yet. The first bot tick will record an equity snapshot.</Empty>
      </Card>
    );
  }
  const k = o.kpis;
  const s = o.stats;
  const allTime = k.equity - k.startEquity;
  const classes = (["us_equity", "crypto"] as const).map((cls) => ({ cls, ...o.classes[cls] }));
  const total = classes.reduce(
    (a, c) => ({
      exposure: a.exposure + c.exposure,
      openPositions: a.openPositions + c.openPositions,
      realized: a.realized + c.realized,
      unrealized: a.unrealized + c.unrealized,
      fees: a.fees + c.fees,
      trades: a.trades + c.trades,
    }),
    { exposure: 0, openPositions: 0, realized: 0, unrealized: 0, fees: 0, trades: 0 },
  );

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Hero: account value with its equity curve */}
        <section className="panel rise flex flex-col overflow-hidden lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 px-6 pt-5">
            <div>
              <div className="label">Net liquidation value</div>
              <div className="figure mt-1 text-[40px] leading-none font-semibold text-ink sm:text-[46px]">
                {usd(k.equity)}
              </div>
            </div>
            <dl className="flex gap-8 pb-1">
              <div>
                <dt className="label">Today</dt>
                <dd className="mt-1 text-[15px]">
                  <Delta value={k.dayPnl}>{signedUsd(k.dayPnl)}</Delta>{" "}
                  <span className="text-xs">
                    <Delta value={k.dayPnlPct}>{signedPct(k.dayPnlPct)}</Delta>
                  </span>
                </dd>
              </div>
              <div>
                <dt className="label">All-time</dt>
                <dd className="mt-1 text-[15px]">
                  <Delta value={allTime}>{signedUsd(allTime)}</Delta>{" "}
                  <span className="text-xs">
                    <Delta value={k.totalReturn}>{signedPct(k.totalReturn)}</Delta>
                  </span>
                </dd>
              </div>
            </dl>
          </div>
          {/* Chart fills whatever height the row gives it (matches the Account panel). */}
          <div className="relative mt-4 min-h-[280px] flex-1">
            <div className="absolute inset-0 px-2 pb-3">
              <EquityChart data={o.equity} height="100%" />
            </div>
          </div>
        </section>

        {/* Account & bot */}
        <Card
          title="Account"
          action={
            o.paused ? (
              <StatusBadge status="paused" />
            ) : o.lastRun ? (
              <StatusBadge status={o.lastRun.status} label={o.lastRun.status === "ok" ? "Healthy" : undefined} />
            ) : undefined
          }
        >
          <KeyValueList
            rows={[
              { label: "Cash", value: usd(k.cash) },
              { label: "Exposure", value: pct(k.exposure, 1) },
              { label: "Open positions", value: k.openPositions },
              { label: "Realized P&L", value: <Delta value={k.realizedPnl}>{signedUsd(k.realizedPnl)}</Delta> },
              { label: "Unrealized P&L", value: <Delta value={k.unrealizedPnl}>{signedUsd(k.unrealizedPnl)}</Delta> },
              { label: "Crypto fees", value: usd(k.fees) },
              { label: "Tracking since", value: longDate(k.since) },
            ]}
          />
          {o.lastRun && (
            <div className="mt-5 rounded-lg border border-line bg-surface-2/60 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="label">Last run</span>
                <span className="num text-xs text-ink-2">{dateTime(o.lastRun.startedAt)}</span>
              </div>
              <p className={`mt-1.5 text-xs ${o.lastRun.error ? "text-loss" : "text-muted"}`}>
                {o.lastRun.error ?? o.lastRun.message ?? "—"}
              </p>
              <Link href="/runs" className="mt-2 inline-block text-xs font-medium text-accent hover:underline">
                View run log →
              </Link>
            </div>
          )}
        </Card>
      </div>

      <StatStrip
        cols={6}
        items={[
          { label: "Max drawdown", value: pct(k.maxDrawdown), sub: `${pct(k.currentDrawdown)} from peak now` },
          { label: "Sharpe", value: ratio(k.sharpe), sub: `annualized · ${k.days} day${k.days === 1 ? "" : "s"}` },
          { label: "Sortino", value: ratio(k.sortino), sub: "annualized" },
          { label: "Win rate", value: s.winRate === null ? "—" : pct(s.winRate, 0), sub: `${s.wins} won · ${s.losses} lost` },
          { label: "Profit factor", value: ratio(s.profitFactor), sub: "gross win ÷ gross loss" },
          { label: "Expectancy", value: s.expectancy === null ? "—" : signedUsd(s.expectancy), sub: "avg P&L per trade" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Performance" subtitle="Cumulative return vs SPY and BTC" className="lg:col-span-2">
          {o.performance.length > 1 ? (
            <PerformanceChart data={o.performance} />
          ) : (
            <Empty>The benchmark comparison starts after two days of history.</Empty>
          )}
        </Card>
        <Card title="Drawdown" subtitle="Below running peak">
          <DrawdownChart data={o.drawdown} />
        </Card>
      </div>

      <Card title="Allocation" subtitle="By asset class">
        <Table>
          <thead>
            <tr>
              <th>Class</th>
              <th className="text-right!">Exposure</th>
              <th className="text-right!">Open</th>
              <th className="text-right!">Realized</th>
              <th className="text-right!">Unrealized</th>
              <th className="text-right!">Fees</th>
              <th className="text-right!">Trades</th>
              <th className="text-right!">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => (
              <tr key={c.cls}>
                <td className="whitespace-nowrap">
                  <span className="font-medium text-ink">{classLabel(c.cls)}</span>
                  <span className="ml-2 text-xs text-muted">
                    {c.cls === "crypto" ? "BTC · ETH · SOL, 24/7" : "10 symbols, market hours"}
                  </span>
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
                <td className="num text-right">{c.trades}</td>
                <td className="num text-right">{c.winRate === null ? "—" : pct(c.winRate, 0)}</td>
              </tr>
            ))}
            <tr className="bg-surface-2/40 font-medium">
              <td className="text-ink">Total</td>
              <td className="num text-right">{pct(k.equity ? total.exposure / k.equity : 0, 1)}</td>
              <td className="num text-right">{total.openPositions}</td>
              <td className="num text-right">
                <Delta value={total.realized}>{signedUsd(total.realized)}</Delta>
              </td>
              <td className="num text-right">
                <Delta value={total.unrealized}>{signedUsd(total.unrealized)}</Delta>
              </td>
              <td className="num text-right text-ink-2">{usd(total.fees)}</td>
              <td className="num text-right">{total.trades}</td>
              <td className="num text-right">{s.winRate === null ? "—" : pct(s.winRate, 0)}</td>
            </tr>
          </tbody>
        </Table>
      </Card>

      <Card
        title="Recent closed trades"
        action={
          <Link href="/trades" className="text-xs font-medium text-accent hover:underline">
            All trades →
          </Link>
        }
      >
        {o.recentTrades.length ? (
          <Table>
            <thead>
              <tr>
                <th>Closed</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th className="text-right!">Entry → Exit</th>
                <th className="text-right!">P&amp;L</th>
                <th className="text-right!">Held</th>
              </tr>
            </thead>
            <tbody>
              {o.recentTrades.map((t, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="font-medium text-ink">{t.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(t.strategy)}</td>
                  <td className="num text-right whitespace-nowrap">
                    {usd(t.entryPrice)} → {usd(t.exitPrice)}
                  </td>
                  <td className="num text-right">
                    <Delta value={t.pnl}>{signedUsd(t.pnl)}</Delta>
                  </td>
                  <td className="num text-right text-ink-2">{duration(t.holdMs)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No closed trades yet. They appear here once the bot exits its first position.</Empty>
        )}
      </Card>
    </div>
  );
}
