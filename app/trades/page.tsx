import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { unitFor } from "@/components/emblems";
import { SymbolPnlChart } from "@/components/charts";
import { ActionBadge, Card, ClassTabs, Delta, Empty, PageHeader, Skeleton, StatStrip, Table } from "@/components/ui";
import { dateTime, duration, pct, qty, ratio, signedPct, signedUsd, usd } from "@/lib/format";
import { getTrades, parseClassFilter } from "@/lib/queries";

export default function TradesPage({ searchParams }: PageProps<"/trades">) {
  return (
    <>
      <PageHeader code="SYS-03 // Combat log" title="Combat Log" subtitle="Closed engagements (first-in first-out) and every order fired" />
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
            sub: `avg win ${s.avgWin === null ? "—" : signedUsd(s.avgWin)} · avg loss ${s.avgLoss === null ? "—" : signedUsd(s.avgLoss)}`,
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
        <Card title="Damage dealt by target" subtitle="Realized P&L per symbol" code="LOG-01">
          <SymbolPnlChart data={bySymbol} />
        </Card>
      )}

      <Card title="Closed engagements" code="LOG-02">
        {trades.length ? (
          <Table>
            <thead>
              <tr>
                <th>Opened</th>
                <th>Closed</th>
                <th>Target</th>
                <th>Unit</th>
                <th className="text-right!">Qty</th>
                <th className="text-right!">Entry</th>
                <th className="text-right!">Exit</th>
                <th className="text-right!">P&amp;L</th>
                <th className="text-right!">Held</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(t.entryTs)}</td>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(t.exitTs)}</td>
                  <td className="num font-medium text-ink">{t.symbol}</td>
                  <td className="hud text-[12px] whitespace-nowrap text-ink-2">{unitFor(t.strategy)?.code ?? "Manual"}</td>
                  <td className="num text-right">{qty(t.qty)}</td>
                  <td className="num text-right">{usd(t.entryPrice)}</td>
                  <td className="num text-right">{usd(t.exitPrice)}</td>
                  <td className="text-right whitespace-nowrap">
                    <Delta value={t.pnl}>
                      {signedUsd(t.pnl)} <span className="text-xs">({signedPct(t.returnPct)})</span>
                    </Delta>
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
          <Empty>No closed trades yet.</Empty>
        )}
      </Card>

      <Card title="Orders fired" subtitle="Latest 200, including protective stops" code="LOG-03">
        {orders.length ? (
          <Table>
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Target</th>
                <th>Side</th>
                <th>Type</th>
                <th>Unit</th>
                <th className="text-right!">Qty</th>
                <th className="text-right!">Fill</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(o.submittedAt)}</td>
                  <td className="num font-medium text-ink">{o.symbol}</td>
                  <td>
                    <ActionBadge action={o.side} />
                  </td>
                  <td className="text-ink-2">
                    {o.isLeg ? "↳ " : ""}
                    {o.type}
                    {o.stopPrice ? ` @ ${usd(o.stopPrice)}` : ""}
                  </td>
                  <td className="hud text-[12px] whitespace-nowrap text-ink-2">{unitFor(o.strategy)?.code ?? "Manual"}</td>
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
