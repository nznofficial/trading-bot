import { connection } from "next/server";
import { Suspense } from "react";
import { Card, ClassTabs, Delta, Empty, PageHeader, Skeleton, Table } from "@/components/ui";
import { dateTime, qty, signedPct, signedUsd, strategyLabel, usd } from "@/lib/format";
import { getPositions, parseClassFilter } from "@/lib/queries";

export default function PositionsPage({ searchParams }: PageProps<"/positions">) {
  return (
    <>
      <PageHeader kicker="The Book" title="Positions" subtitle="Open positions as of the latest bot tick." />
      <Suspense fallback={<Skeleton />}>
        <Positions searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Positions({ searchParams }: { searchParams: PageProps<"/positions">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const filter = parseClassFilter((await searchParams).class);
  const { asOf, positions } = await getPositions(filter);
  const total = positions.reduce((a, p) => a + p.marketValue, 0);
  const upl = positions.reduce((a, p) => a + p.unrealizedPl, 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <ClassTabs path="/positions" active={filter} />
      <Card
        title={`${positions.length} open position${positions.length === 1 ? "" : "s"}`}
        subtitle={asOf ? `Snapshot ${dateTime(asOf)}` : undefined}
      >
        {positions.length ? (
          <Table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Strategy</th>
                <th className="text-right!">Qty</th>
                <th className="text-right!">Avg entry</th>
                <th className="text-right!">Last</th>
                <th className="text-right!">Market value</th>
                <th className="text-right!">Unrealized</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol}>
                  <td className="font-label text-[11px] tracking-[0.08em] text-ink">{p.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(p.strategy)}</td>
                  <td className="num text-right">{qty(p.qty)}</td>
                  <td className="num text-right">{usd(p.avgEntry)}</td>
                  <td className="num text-right">{usd(p.currentPrice)}</td>
                  <td className="num text-right">{usd(p.marketValue)}</td>
                  <td className="num text-right">
                    <Delta value={p.unrealizedPl}>
                      {signedUsd(p.unrealizedPl)} <span className="text-xs">({signedPct(p.unrealizedPlpc)})</span>
                    </Delta>
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td colSpan={5}>Total</td>
                <td className="num text-right">{usd(total)}</td>
                <td className="num text-right">
                  <Delta value={upl}>{signedUsd(upl)}</Delta>
                </td>
              </tr>
            </tbody>
          </Table>
        ) : (
          <Empty>Flat: no open positions.</Empty>
        )}
      </Card>
    </div>
  );
}
