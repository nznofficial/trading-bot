import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DrawdownChart, EquityChart, PerformanceChart } from "@/components/charts";
import { Card, Delta, Empty, Metric, PageHeader, Skeleton, Stat, StatusBadge, Table } from "@/components/ui";
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
  usd0,
} from "@/lib/format";
import { getOverview } from "@/lib/queries";

export default function OverviewPage() {
  return (
    <>
      <PageHeader kicker="Portfolio" title="Overview" subtitle="Performance, risk, and bot health — stocks and crypto, one book." />
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4">
      <Skeleton className="h-64" />
      <div className="stagger grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
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

  const dollars = Math.trunc(k.equity);
  const cents = Math.round((k.equity - dollars) * 100);
  const allTime = k.equity - k.startEquity;

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Hero scoreboard */}
      <section className="panel scan-in relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_220px_at_15%_0%,rgba(0,229,255,0.12),transparent_70%),radial-gradient(500px_200px_at_100%_100%,rgba(232,194,106,0.08),transparent_70%)]"
        />
        <div className="relative grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_280px] md:p-8">
          <div>
            <div className="label">Net liquidation value</div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="num glow-text text-5xl font-semibold tracking-tight text-ink md:text-7xl">
                {usd0(dollars)}
              </span>
              <span className="num text-2xl text-muted md:text-3xl">.{String(cents).padStart(2, "0")}</span>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <div className="label">Today</div>
                <div className="mt-1.5 text-xl">
                  <Delta value={k.dayPnl} glow>
                    {signedUsd(k.dayPnl)}
                  </Delta>{" "}
                  <span className="text-sm">
                    <Delta value={k.dayPnlPct}>{signedPct(k.dayPnlPct)}</Delta>
                  </span>
                </div>
              </div>
              <div>
                <div className="label">All-time</div>
                <div className="mt-1.5 text-xl">
                  <Delta value={allTime} glow>
                    {signedUsd(allTime)}
                  </Delta>{" "}
                  <span className="text-sm">
                    <Delta value={k.totalReturn}>{signedPct(k.totalReturn)}</Delta>
                  </span>
                </div>
              </div>
              <div>
                <div className="label">Since</div>
                <div className="num mt-1.5 text-xl text-ink-2">{longDate(k.since)}</div>
              </div>
            </div>
          </div>

          <aside className="flex flex-col gap-4 border-t border-line pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div>
              <div className="label">Bot status</div>
              <div className="mt-2 flex items-center gap-3">
                {o.paused ? <StatusBadge status="paused" /> : o.lastRun && <StatusBadge status={o.lastRun.status} />}
                {o.lastRun && <span className="num text-xs text-muted">{dateTime(o.lastRun.startedAt)}</span>}
              </div>
              {o.lastRun?.error && <p className="mt-2 text-xs text-loss">{o.lastRun.error}</p>}
              {o.lastRun?.message && !o.lastRun.error && <p className="mt-2 text-xs text-ink-2">{o.lastRun.message}</p>}
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <Metric label="Realized">
                <Delta value={k.realizedPnl}>{signedUsd(k.realizedPnl)}</Delta>
              </Metric>
              <Metric label="Unrealized">
                <Delta value={k.unrealizedPnl}>{signedUsd(k.unrealizedPnl)}</Delta>
              </Metric>
              <Metric label="Cash">{usd0(k.cash)}</Metric>
              <Metric label="Fees">{usd(k.fees)}</Metric>
            </dl>
            <Link
              href="/runs"
              className="mt-auto font-label text-[10px] tracking-[0.16em] text-neon uppercase hover:underline"
            >
              Run log →
            </Link>
          </aside>
        </div>
      </section>

      <div className="stagger grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Max drawdown" value={pct(k.maxDrawdown)} sub={`currently ${pct(k.currentDrawdown)} from peak`} />
        <Stat
          label="Sharpe (ann.)"
          value={ratio(k.sharpe)}
          sub={`Sortino ${ratio(k.sortino)} · ${k.days} day${k.days === 1 ? "" : "s"}`}
        />
        <Stat
          label="Win rate"
          value={s.winRate === null ? "—" : pct(s.winRate, 0)}
          sub={`${s.wins}W / ${s.losses}L · PF ${ratio(s.profitFactor)}`}
        />
        <Stat
          label="Exposure"
          value={pct(k.exposure, 0)}
          sub={`${k.openPositions} position${k.openPositions === 1 ? "" : "s"} open`}
        />
      </div>

      <Card title="Equity curve" subtitle="Account value at every bot tick">
        <EquityChart data={o.equity} />
      </Card>

      <div className="stagger grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Performance vs SPY & BTC" subtitle="Cumulative return by day">
          {o.performance.length > 1 ? (
            <PerformanceChart data={o.performance} />
          ) : (
            <Empty>Needs at least two days of history.</Empty>
          )}
        </Card>
        <Card title="Drawdown" subtitle="Distance below the running equity peak">
          <DrawdownChart data={o.drawdown} />
        </Card>
      </div>

      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">
        {(["us_equity", "crypto"] as const).map((cls) => {
          const c = o.classes[cls];
          return (
            <Card
              key={cls}
              title={classLabel(cls)}
              subtitle={cls === "crypto" ? "BTC · ETH · SOL — 24/7" : "10 stocks & ETFs — market hours"}
            >
              <dl className="grid grid-cols-3 gap-4">
                <Metric label="Realized">
                  <Delta value={c.realized}>{signedUsd(c.realized)}</Delta>
                </Metric>
                <Metric label="Unrealized">
                  <Delta value={c.unrealized}>{signedUsd(c.unrealized)}</Delta>
                </Metric>
                <Metric label="Exposure">{pct(k.equity ? c.exposure / k.equity : 0, 1)}</Metric>
                <Metric label="Open">{c.openPositions}</Metric>
                <Metric label="Trades">
                  {c.trades}
                  {c.winRate !== null && <span className="text-muted"> · {pct(c.winRate, 0)} won</span>}
                </Metric>
                <Metric label="Fees">{cls === "crypto" ? usd(c.fees) : "—"}</Metric>
              </dl>
            </Card>
          );
        })}
      </div>

      <Card title="Recent closed trades">
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
                  <td className="num text-xs text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="font-label text-[11px] tracking-[0.08em] text-ink">{t.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(t.strategy)}</td>
                  <td className="num text-right">
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
          <Empty>No closed trades yet.</Empty>
        )}
      </Card>
    </div>
  );
}
