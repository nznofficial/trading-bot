import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { DrawdownChart, EquityChart, PerformanceChart } from "@/components/charts";
import { Card, Delta, Empty, PageHeader, Skeleton, Stat, StatusBadge, Table } from "@/components/ui";
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
      <PageHeader title="Overview" subtitle="Portfolio performance, risk, and bot health." />
      <Suspense fallback={<OverviewSkeleton />}>
        <Overview />
      </Suspense>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
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

  return (
    <div className="grid gap-4">
      {o.lastRun && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm">
          <StatusBadge status={o.lastRun.status} />
          <span className="text-ink-2">Last run {dateTime(o.lastRun.startedAt)}</span>
          {o.lastRun.message && <span className="text-muted">{o.lastRun.message}</span>}
          {o.lastRun.error && <span className="text-down">{o.lastRun.error}</span>}
          {o.paused && <span className="font-medium text-ink">Bot paused</span>}
          <Link href="/runs" className="ml-auto text-xs text-ink-2 underline-offset-2 hover:underline">
            Run log →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Equity" value={usd0(k.equity)} sub={`from ${usd0(k.startEquity)} on ${longDate(k.since)}`} />
        <Stat
          label="Total return"
          value={<Delta value={k.totalReturn}>{signedPct(k.totalReturn)}</Delta>}
          sub={<Delta value={k.equity - k.startEquity}>{signedUsd(k.equity - k.startEquity)}</Delta>}
        />
        <Stat
          label="Today"
          value={<Delta value={k.dayPnl}>{signedUsd(k.dayPnl)}</Delta>}
          sub={<Delta value={k.dayPnlPct}>{signedPct(k.dayPnlPct)}</Delta>}
        />
        <Stat
          label="Max drawdown"
          value={<span className="num">{pct(k.maxDrawdown)}</span>}
          sub={`currently ${pct(k.currentDrawdown)} from peak`}
        />
      </div>

      <Card title="Equity" subtitle="Account value at every bot tick">
        <EquityChart data={o.equity} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Sharpe (ann.)" value={<span className="num">{ratio(k.sharpe)}</span>} sub={`Sortino ${ratio(k.sortino)} · ${k.days} day${k.days === 1 ? "" : "s"}`} />
        <Stat
          label="Win rate"
          value={<span className="num">{s.winRate === null ? "—" : pct(s.winRate, 0)}</span>}
          sub={`${s.wins}W / ${s.losses}L · PF ${ratio(s.profitFactor)}`}
        />
        <Stat
          label="Realized P&L"
          value={<Delta value={k.realizedPnl}>{signedUsd(k.realizedPnl)}</Delta>}
          sub={
            <>
              unrealized <Delta value={k.unrealizedPnl}>{signedUsd(k.unrealizedPnl)}</Delta>
              {k.fees > 0 && <> · fees {usd(k.fees)}</>}
            </>
          }
        />
        <Stat
          label="Exposure"
          value={<span className="num">{pct(k.exposure, 0)}</span>}
          sub={`${k.openPositions} positions · ${usd0(k.cash)} cash`}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(["us_equity", "crypto"] as const).map((cls) => {
          const c = o.classes[cls];
          return (
            <Card key={cls} title={classLabel(cls)} subtitle={cls === "crypto" ? "BTC, ETH, SOL · 24/7" : "10 stocks & ETFs · market hours"}>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted">Realized</dt>
                  <dd><Delta value={c.realized}>{signedUsd(c.realized)}</Delta></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Unrealized</dt>
                  <dd><Delta value={c.unrealized}>{signedUsd(c.unrealized)}</Delta></dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Exposure</dt>
                  <dd className="num">{pct(k.equity ? c.exposure / k.equity : 0, 1)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Open</dt>
                  <dd className="num">{c.openPositions}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Trades</dt>
                  <dd className="num">{c.trades}{c.winRate !== null && <span className="text-muted"> · {pct(c.winRate, 0)} won</span>}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Fees</dt>
                  <dd className="num">{cls === "crypto" ? usd(c.fees) : "—"}</dd>
                </div>
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
                  <td className="text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="font-medium">{t.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(t.strategy)}</td>
                  <td className="text-right">
                    {usd(t.entryPrice)} → {usd(t.exitPrice)}
                  </td>
                  <td className="text-right">
                    <Delta value={t.pnl}>{signedUsd(t.pnl)}</Delta>
                  </td>
                  <td className="text-right text-ink-2">{duration(t.holdMs)}</td>
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
