import { connection } from "next/server";
import { Suspense } from "react";
import { UNITS, UnitEmblem, unitFor, type UnitId } from "@/components/emblems";
import { TuneConsole } from "@/components/tune-console";
import { ActionBadge, Card, ClassTabs, Delta, Empty, Gauge, Metric, PageHeader, Skeleton, Table, Tag } from "@/components/ui";
import { dateTime, duration, pct, ratio, signedUsd } from "@/lib/format";
import { getStrategies, parseClassFilter } from "@/lib/queries";

export default function HangarPage({ searchParams }: PageProps<"/strategies">) {
  return (
    <>
      <PageHeader code="SYS-04 // Hangar" title="Hangar" subtitle="Strategy units · loadout, combat record, targeting" />
      <Suspense fallback={<Skeleton />}>
        <Hangar searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const fmtIndicators = (ind: Record<string, number | null>) =>
  Object.entries(ind)
    .filter(([k, v]) => k !== "close" && v !== null)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

async function Hangar({ searchParams }: { searchParams: PageProps<"/strategies">["searchParams"] }) {
  await connection(); // DB-backed: render at request time, never at build
  const filter = parseClassFilter((await searchParams).class);
  const { live, strategies, latest, recent } = await getStrategies(filter);

  return (
    <div className="grid grid-cols-1 gap-5">
      <ClassTabs path="/strategies" active={filter} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {strategies.map((st) => {
          const unit = UNITS[st.id as UnitId];
          return (
            <section key={st.id} className="frame frame-hot boot">
              <div className="frame-body relative overflow-hidden">
                {/* Unit color band */}
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: `linear-gradient(90deg, ${unit.primary}, ${unit.secondary})` }}
                />
                <div className="flex items-start gap-5 px-5 pt-6 pb-4">
                  <div className="shrink-0" style={{ filter: `drop-shadow(0 0 14px ${unit.primary}88)` }}>
                    <UnitEmblem unit={st.id as UnitId} size={88} />
                  </div>
                  <div className="min-w-0">
                    <div className="hud text-[12px]" style={{ color: unit.secondary }}>
                      {unit.code} · {unit.role}
                    </div>
                    <h2 className="mt-1 font-title text-[32px] leading-none font-extrabold text-ink">{unit.callsign}</h2>
                    <div className="hud mt-1.5 text-[13px] text-ink-2">{st.name}</div>
                  </div>
                </div>
                <p className="px-5 text-[14px] leading-relaxed text-ink-2">{st.description}</p>

                <div className="grid grid-cols-1 gap-3.5 px-5 pt-5">
                  <Gauge
                    label="Sync rate"
                    value={st.stats.winRate ?? 0}
                    readout={st.stats.winRate === null ? "—" : pct(st.stats.winRate, 0)}
                    color={unit.primary}
                    caption="Win rate on closed trades"
                  />
                  <Gauge
                    label="Sorties flown"
                    value={Math.min(1, st.stats.count / 50)}
                    readout={st.stats.count}
                    color={unit.secondary}
                    caption="Closed trades (bar fills at 50)"
                  />
                </div>

                <dl className="mt-5 grid grid-cols-3 gap-px border-t border-line bg-line">
                  {[
                    ["Realized", <Delta key="r" value={st.stats.totalPnl}>{signedUsd(st.stats.totalPnl)}</Delta>],
                    ["Unrealized", <Delta key="u" value={st.unrealizedPl}>{signedUsd(st.unrealizedPl)}</Delta>],
                    ["Deployed", st.openPositions],
                    ["Profit factor", ratio(st.stats.profitFactor)],
                    ["Avg hold", duration(st.stats.avgHoldMs)],
                    ["Expectancy", st.stats.expectancy === null ? "—" : signedUsd(st.stats.expectancy)],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-surface px-5 py-3">
                      <Metric label={label as string}>{value}</Metric>
                    </div>
                  ))}
                </dl>

                <div className="border-t border-line px-5 py-4">
                  <div className="hud mb-2 text-[11px] text-muted">Assigned targets</div>
                  <div className="flex flex-wrap gap-1.5">
                    {st.symbols.map((sym) => (
                      <Tag key={sym}>{sym}</Tag>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      <Card
        title="Tune units"
        subtitle={`Live now · stop ${(live.stopLossPct * 100).toFixed(1)}% · equities ${live.stocksEnabled ? "armed" : "safed"} · crypto ${live.cryptoEnabled ? "armed" : "safed"}`}
        code="HGR-01"
        tone="amber"
      >
        <TuneConsole current={live} />
      </Card>

      <Card title="Targeting computer" subtitle="Latest evaluation of every target" code="TGT-01">
        {latest.length ? (
          <Table>
            <thead>
              <tr>
                <th>Target</th>
                <th>Unit</th>
                <th>Order</th>
                <th>Assessment</th>
                <th>Telemetry</th>
                <th>As of</th>
              </tr>
            </thead>
            <tbody>
              {latest.map((s) => (
                <tr key={s.id}>
                  <td className="num font-medium text-ink">{s.symbol}</td>
                  <td className="hud text-[12px] whitespace-nowrap" style={{ color: unitFor(s.strategy)?.secondary }}>
                    {unitFor(s.strategy)?.code ?? s.strategy}
                  </td>
                  <td>
                    <ActionBadge action={s.action} />
                  </td>
                  <td className="text-ink-2">{s.note ?? s.reason}</td>
                  <td className="num text-[12px] text-muted">{fmtIndicators(s.indicators)}</td>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(s.ts)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>Targeting comes online after the first sortie.</Empty>
        )}
      </Card>

      <Card title="Engagement orders" subtitle="Last 100 buy/sell calls, including ones blocked by risk limits" code="TGT-02">
        {recent.length ? (
          <Table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Target</th>
                <th>Order</th>
                <th>Assessment</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id}>
                  <td className="num whitespace-nowrap text-ink-2">{dateTime(s.ts)}</td>
                  <td className="num font-medium text-ink">{s.symbol}</td>
                  <td>
                    <ActionBadge action={s.action} />
                  </td>
                  <td className="text-ink-2">{s.reason}</td>
                  <td className={s.acted ? "text-ink" : "text-muted"}>{s.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No buy or sell calls yet. Units are holding.</Empty>
        )}
      </Card>
    </div>
  );
}
