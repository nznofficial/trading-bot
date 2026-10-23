import { connection } from "next/server";
import { Suspense } from "react";
import { SymbolPnlChart } from "@/components/charts";
import { ActionBadge, Card, ClassTabs, Delta, Empty, PageHeader, Skeleton, StatStrip, Table } from "@/components/ui";
import { dateTime, duration, pct, qty, ratio, signedPct, signedUsd, strategyLabel, usd } from "@/lib/format";
import { getTrades, parseClassFilter } from "@/lib/queries";

export default function TradesPage({ searchParams }: PageProps<"/trades">) {
  return (
    <>
      <PageHeader title="Trades" subtitle="Closed round trips (FIFO-matched fills) and the raw order log." />
      <Suspense fallback={<Skeleton />}>
        <Trades searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Trades({ searchParams }: { searchParams: PageProps<"/trades">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const filter = parseClassFilter((await searchParams).class);
  const { stats: s, fees, trades, bySymbol, orders } = await getTrades(filter);

  return (
    <div className="grid grid-cols-1 gap-4">
      <ClassTabs path="/trades" active={filter} />
      <StatStrip
        items={[
          { label: "Closed trades", value: s.count, sub: `avg hold ${duration(s.avgHoldMs)}` },
          { label: "Win rate", value: s.winRate === null ? "—" : pct(s.winRate, 0), sub: `${s.wins} won · ${s.losses} lost` },
          {
            label: "Expectancy",
            value: s.expectancy === null ? "—" : <Delta value={s.expectancy}>{signedUsd(s.expectancy)}</Delta>,
            sub: `avg win ${s.avgWin === null ? "—" : usd(s.avgWin)} · avg loss ${s.avgLoss === null ? "—" : usd(s.avgLoss)}`,
          },
          {
            label: "Profit factor",
            value: ratio(s.profitFactor),
            sub: (
              <>
                total <Delta value={s.totalPnl}>{signedUsd(s.totalPnl)}</Delta>
                {fees > 0 && <> · fees {usd(fees)}</>}
              </>
            ),
          },
        ]}
      />

      {bySymbol.length > 0 && (
        <Card title="Realized P&L by symbol">
          <SymbolPnlChart data={bySymbol} />
        </Card>
      )}

      <Card title="Closed trades">
        {trades.length ? (
          <Table>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Closed</th>
                <th>Symbol</th>
                <th>Strategy</th>
                <th className="text-right!">Qty</th>
                <th className="text-right!">Entry</th>
                <th className="text-right!">Exit</th>
                <th className="text-right!">P&amp;L</th>
                <th className="text-right!">Held</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i}>
                  <td className="num text-xs text-ink-2">{dateTime(t.entryTs)}</td>
                  <td className="num text-xs text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="font-medium text-ink">{t.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(t.strategy)}</td>
                  <td className="num text-right">{qty(t.qty)}</td>
                  <td className="num text-right">{usd(t.entryPrice)}</td>
                  <td className="num text-right">{usd(t.exitPrice)}</td>
                  <td className="text-right whitespace-nowrap">
                    <Delta value={t.pnl}>
                      {signedUsd(t.pnl)} <span className="text-xs">({signedPct(t.returnPct)})</span>
                    </Delta>
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

      <Card title="Orders" subtitle="Latest 200, including protective stop legs">
        {orders.length ? (
          <Table>
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Type</th>
                <th>Strategy</th>
                <th className="text-right!">Qty</th>
                <th className="text-right!">Fill</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="num text-xs text-ink-2">{dateTime(o.submittedAt)}</td>
                  <td className="font-medium text-ink">{o.symbol}</td>
                  <td>
                    <ActionBadge action={o.side} />
                  </td>
                  <td className="text-ink-2">
                    {o.isLeg ? "↳ " : ""}
                    {o.type}
                    {o.stopPrice ? ` @ ${usd(o.stopPrice)}` : ""}
                  </td>
                  <td className="text-ink-2">{strategyLabel(o.strategy)}</td>
                  <td className="num text-right">{o.qty === null ? "—" : qty(o.qty)}</td>
                  <td className="num text-right">{o.filledAvgPrice ? usd(o.filledAvgPrice) : "—"}</td>
                  <td className="text-ink-2">{o.status.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No orders yet.</Empty>
        )}
      </Card>
    </div>
  );
}
