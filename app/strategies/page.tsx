import { connection } from "next/server";
import { Suspense } from "react";
import { ActionBadge, Card, Delta, Empty, PageHeader, Skeleton, Table } from "@/components/ui";
import { dateTime, pct, ratio, signedUsd, strategyLabel } from "@/lib/format";
import { getStrategies } from "@/lib/queries";

export default function StrategiesPage() {
  return (
    <>
      <PageHeader title="Strategies" subtitle="How each rule set is performing, and what it's seeing right now." />
      <Suspense fallback={<Skeleton />}>
        <Strategies />
      </Suspense>
    </>
  );
}

const fmtIndicators = (ind: Record<string, number | null>) =>
  Object.entries(ind)
    .filter(([k, v]) => k !== "close" && v !== null)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

async function Strategies() {
  await connection(); // DB-backed: render at request time, never at build
  const { strategies, latest, recent } = await getStrategies();

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {strategies.map((st) => (
          <Card key={st.id} title={st.name} subtitle={st.description}>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Realized</dt>
                <dd><Delta value={st.stats.totalPnl}>{signedUsd(st.stats.totalPnl)}</Delta></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Unrealized</dt>
                <dd><Delta value={st.unrealizedPl}>{signedUsd(st.unrealizedPl)}</Delta></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Open</dt>
                <dd className="num">{st.openPositions}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Trades</dt>
                <dd className="num">{st.stats.count}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Win rate</dt>
                <dd className="num">{st.stats.winRate === null ? "—" : pct(st.stats.winRate, 0)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Profit factor</dt>
                <dd className="num">{ratio(st.stats.profitFactor)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-ink-2">Trades {st.symbols.join(", ")}</p>
          </Card>
        ))}
      </div>

      <Card title="Latest signals" subtitle={latest[0] ? `From the tick at ${dateTime(latest[0].ts)}` : undefined}>
        {latest.length ? (
          <Table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Signal</th>
                <th>Reason</th>
                <th>Indicators</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">{s.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(s.strategy)}</td>
                  <td><ActionBadge action={s.action} /></td>
                  <td className="text-ink-2">{s.note ?? s.reason}</td>
                  <td className="text-xs text-muted">{fmtIndicators(s.indicators)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>Signals appear once the bot runs during market hours.</Empty>
        )}
      </Card>

      <Card title="Signal history" subtitle="Last 100 buy/sell signals, including ones blocked by risk limits">
        {recent.length ? (
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Reason</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td className="text-ink-2 whitespace-nowrap">{dateTime(s.ts)}</td>
                  <td className="font-medium">{s.symbol}</td>
                  <td><ActionBadge action={s.action} /></td>
                  <td className="text-ink-2">{s.reason}</td>
                  <td className={s.acted ? "text-ink" : "text-muted"}>{s.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No actionable signals yet.</Empty>
        )}
      </Card>
    </div>
  );
}
