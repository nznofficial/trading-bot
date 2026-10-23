import { connection } from "next/server";
import { Suspense } from "react";
import { ActionBadge, Card, ClassTabs, Delta, Empty, Metric, PageHeader, Skeleton, Table } from "@/components/ui";
import { dateTime, pct, ratio, signedUsd, strategyLabel } from "@/lib/format";
import { getStrategies, parseClassFilter } from "@/lib/queries";

export default function StrategiesPage({ searchParams }: PageProps<"/strategies">) {
  return (
    <>
      <PageHeader kicker="Signal Desk" title="Strategies" subtitle="How each rule set is performing, and what it's seeing right now." />
      <Suspense fallback={<Skeleton />}>
        <Strategies searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const fmtIndicators = (ind: Record<string, number | null>) =>
  Object.entries(ind)
    .filter(([k, v]) => k !== "close" && v !== null)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

async function Strategies({ searchParams }: { searchParams: PageProps<"/strategies">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const filter = parseClassFilter((await searchParams).class);
  const { strategies, latest, recent } = await getStrategies(filter);

  return (
    <div className="grid grid-cols-1 gap-4">
      <ClassTabs path="/strategies" active={filter} />
      <div className="stagger grid grid-cols-1 gap-4 md:grid-cols-2">
        {strategies.map((st) => (
          <Card key={st.id} title={st.name} subtitle={st.description}>
            <dl className="grid grid-cols-3 gap-4">
              <Metric label="Realized">
                <Delta value={st.stats.totalPnl}>{signedUsd(st.stats.totalPnl)}</Delta>
              </Metric>
              <Metric label="Unrealized">
                <Delta value={st.unrealizedPl}>{signedUsd(st.unrealizedPl)}</Delta>
              </Metric>
              <Metric label="Open">{st.openPositions}</Metric>
              <Metric label="Trades">{st.stats.count}</Metric>
              <Metric label="Win rate">{st.stats.winRate === null ? "—" : pct(st.stats.winRate, 0)}</Metric>
              <Metric label="Profit factor">{ratio(st.stats.profitFactor)}</Metric>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {st.symbols.map((sym) => (
                <span key={sym} className="rounded-sm border border-line px-1.5 py-0.5 font-label text-[9px] tracking-[0.12em] text-ink-2">
                  {sym}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card title="Latest signals" subtitle="Most recent evaluation of each symbol">
        {latest.length ? (
          <Table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Strategy</th>
                <th>Signal</th>
                <th>Reason</th>
                <th>Indicators</th>
                <th>As of</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((s) => (
                <tr key={s.id}>
                  <td className="font-label text-[11px] tracking-[0.08em] text-ink">{s.symbol}</td>
                  <td className="text-ink-2">{strategyLabel(s.strategy)}</td>
                  <td><ActionBadge action={s.action} /></td>
                  <td className="text-ink-2">{s.note ?? s.reason}</td>
                  <td className="num text-[11px] text-muted">{fmtIndicators(s.indicators)}</td>
                  <td className="num text-[11px] whitespace-nowrap text-muted">{dateTime(s.ts)}</td>
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
                  <td className="num text-xs whitespace-nowrap text-ink-2">{dateTime(s.ts)}</td>
                  <td className="font-label text-[11px] tracking-[0.08em] text-ink">{s.symbol}</td>
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
