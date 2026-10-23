import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { DrawdownChart, EquityChart, PerformanceChart } from "@/components/charts";
import { Card, Delta, Empty, KeyValueList, PageHeader, Skeleton, StatusBadge, Table } from "@/components/ui";
import {
  classLabel,
  dateTime,
  duration,
  longDate,
  pct,
  qty,
  ratio,
  signedPct,
  signedUsd,
  strategyLabel,
  usd,
} from "@/lib/format";
import { getOverview } from "@/lib/queries";

export default function SummaryPage() {
  return (
    <>
      <PageHeader title="Account Summary" subtitle="Simulated brokerage account trading U.S. equities and crypto." />
      <Suspense fallback={<SummarySkeleton />}>
        <Summary />
      </Suspense>
    </>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5">
      <Skeleton className="h-36" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
    </div>
  );
}

const ALLOC_COLORS = { us_equity: "var(--series-1)", crypto: "var(--series-3)", cash: "#c9d0d9" } as const;

async function Summary() {
  await connection(); // DB-backed: render at request time, never at build
  const o = await getOverview();
  if (!o.hasData || !o.kpis) {
    return (
      <Card>
        <Empty>No account data yet. The first scheduled run records a snapshot.</Empty>
      </Card>
    );
  }
  const k = o.kpis;
  const s = o.stats;
  const gain = k.equity - k.startEquity;
  const securities = o.classes.us_equity.exposure + o.classes.crypto.exposure;
  const allocation = [
    { key: "us_equity" as const, label: "Stocks", value: o.classes.us_equity.exposure },
    { key: "crypto" as const, label: "Crypto", value: o.classes.crypto.exposure },
    { key: "cash" as const, label: "Cash", value: k.cash },
  ];
  const allocTotal = allocation.reduce((a, x) => a + Math.max(x.value, 0), 0) || 1;

  return (
    <div className="grid grid-cols-1 gap-5">
      <p className="-mt-3 text-[13px] text-muted">
        Balances as of {o.lastRun ? dateTime(o.lastRun.startedAt) : "—"} · updated every 15 minutes
      </p>

      {/* Balances */}
      <section className="panel grid grid-cols-1 overflow-hidden lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div className="px-6 py-5">
          <div className="text-[14px] text-ink-2">Total account value</div>
          <div className="num mt-1 font-serif text-[40px] leading-none font-semibold text-navy">{usd(k.equity)}</div>
          <div className="mt-2 text-[14px]">
            <Delta value={k.dayPnl}>
              {signedUsd(k.dayPnl)} ({signedPct(k.dayPnlPct)})
            </Delta>{" "}
            <span className="text-muted">today</span>
          </div>
        </div>
        <Balance label="Total gain/loss" sub={`since ${longDate(k.since)}`}>
          <Delta value={gain}>{signedUsd(gain)}</Delta>
          <span className="ml-1.5 text-[14px]">
            <Delta value={k.totalReturn}>({signedPct(k.totalReturn)})</Delta>
          </span>
        </Balance>
        <Balance label="Securities value" sub={`${k.openPositions} position${k.openPositions === 1 ? "" : "s"}`}>
          {usd(securities)}
        </Balance>
        <Balance label="Cash & cash investments" sub={`${pct(k.equity ? k.cash / k.equity : 0, 1)} of account`}>
          {usd(k.cash)}
        </Balance>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Account value" subtitle={`Recorded every 15 minutes since ${longDate(k.since)}`} className="lg:col-span-2">
          {/* Fills the card so it lines up with the allocation panel beside it. */}
          <div className="relative h-full min-h-[280px]">
            <div className="absolute inset-0">
              <EquityChart data={o.equity} height="100%" />
            </div>
          </div>
        </Card>

        <Card title="Asset allocation">
          <div className="flex h-3 w-full overflow-hidden rounded-sm bg-surface-2" role="img" aria-label="Allocation by asset class">
            {allocation.map((a) =>
              a.value > 0 ? (
                <div
                  key={a.key}
                  style={{ width: `${(a.value / allocTotal) * 100}%`, background: ALLOC_COLORS[a.key] }}
                  className="h-full border-r-2 border-white last:border-r-0"
                />
              ) : null,
            )}
          </div>
          <table className="mt-4 w-full text-[14px]">
            <tbody>
              {allocation.map((a) => (
                <tr key={a.key} className="border-t border-line first:border-t-0">
                  <td className="py-2.5">
                    <span className="mr-2 inline-block size-2.5 rounded-sm align-middle" style={{ background: ALLOC_COLORS[a.key] }} />
                    {a.label}
                  </td>
                  <td className="num py-2.5 text-right font-semibold">{usd(a.value)}</td>
                  <td className="num w-16 py-2.5 text-right text-muted">{pct(a.value / allocTotal, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">Trading bot</h3>
              {o.paused ? <StatusBadge status="paused" /> : o.lastRun && <StatusBadge status={o.lastRun.status} label={o.lastRun.status === "ok" ? "Active" : undefined} />}
            </div>
            <KeyValueList
              rows={[
                { label: "Last run", value: o.lastRun ? dateTime(o.lastRun.startedAt) : "—" },
                { label: "Schedule", value: "Every 15 min, 24/7" },
                { label: "Crypto fees paid", value: usd(k.fees) },
              ]}
            />
            {o.lastRun?.error && <p className="mt-3 text-[13px] text-loss">{o.lastRun.error}</p>}
            <Link href="/runs" className="mt-4 inline-block text-[14px] font-semibold text-accent hover:underline">
              View activity log
            </Link>
          </div>
        </Card>
      </div>

      <Card
        title="Holdings"
        action={
          <Link href="/positions" className="text-[14px] font-semibold text-accent hover:underline">
            View all positions
          </Link>
        }
      >
        {o.positions.length ? (
          <Table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Class</th>
                <th className="text-right!">Quantity</th>
                <th className="text-right!">Price</th>
                <th className="text-right!">Market value</th>
                <th className="text-right!">Cost basis</th>
                <th className="text-right!">Gain/loss</th>
              </tr>
            </thead>
            <tbody>
              {o.positions.map((p) => (
                <tr key={p.symbol}>
                  <td className="font-semibold text-accent">{p.symbol}</td>
                  <td className="text-ink-2">{classLabel(p.assetClass)}</td>
                  <td className="num text-right">{qty(p.qty)}</td>
                  <td className="num text-right">{usd(p.currentPrice)}</td>
                  <td className="num text-right font-semibold">{usd(p.marketValue)}</td>
                  <td className="num text-right">{usd(p.avgEntry * p.qty)}</td>
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
          <Empty>No open positions. The bot buys when a strategy signals an entry.</Empty>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title="Performance" subtitle="Cumulative return compared with SPY and BTC" className="lg:col-span-2">
          {o.performance.length > 1 ? (
            <PerformanceChart data={o.performance} />
          ) : (
            <Empty>The benchmark comparison begins after two days of history.</Empty>
          )}
        </Card>
        <Card title="Risk & return">
          <KeyValueList
            rows={[
              { label: "Maximum drawdown", value: pct(k.maxDrawdown) },
              { label: "Current drawdown", value: pct(k.currentDrawdown) },
              { label: "Sharpe ratio", value: ratio(k.sharpe) },
              { label: "Sortino ratio", value: ratio(k.sortino) },
              { label: "Closed trades", value: s.count },
              { label: "Win rate", value: s.winRate === null ? "—" : pct(s.winRate, 0) },
              { label: "Profit factor", value: ratio(s.profitFactor) },
              { label: "Realized gain/loss", value: <Delta value={k.realizedPnl}>{signedUsd(k.realizedPnl)}</Delta> },
            ]}
          />
          <p className="mt-4 text-[12px] leading-relaxed text-muted">
            Ratios are annualized from daily account values ({k.days} day{k.days === 1 ? "" : "s"} recorded).
          </p>
        </Card>
      </div>

      <Card title="Drawdown" subtitle="Decline from the account's running high">
        <DrawdownChart data={o.drawdown} />
      </Card>

      <Card
        title="Recent activity"
        subtitle="Closed trades"
        action={
          <Link href="/trades" className="text-[14px] font-semibold text-accent hover:underline">
            View history
          </Link>
        }
      >
        {o.recentTrades.length ? (
          <Table>
            <thead>
              <tr>
                <th>Date closed</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th className="text-right!">Entry</th>
                <th className="text-right!">Exit</th>
                <th className="text-right!">Gain/loss</th>
                <th className="text-right!">Held</th>
              </tr>
            </thead>
            <tbody>
              {o.recentTrades.map((t, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="font-semibold text-accent">{t.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(t.strategy)}</td>
                  <td className="num text-right">{usd(t.entryPrice)}</td>
                  <td className="num text-right">{usd(t.exitPrice)}</td>
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

function Balance({ label, sub, children }: { label: string; sub: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-6 py-5 lg:border-t-0 lg:border-l">
      <div className="text-[14px] text-ink-2">{label}</div>
      <div className="num mt-1.5 text-[24px] leading-tight font-semibold text-ink">{children}</div>
      <div className="mt-1.5 text-[13px] text-muted">{sub}</div>
    </div>
  );
}
