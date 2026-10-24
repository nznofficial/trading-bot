import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Image from "next/image";
import { ART, unitBust } from "@/components/art";
import { UNITS, unitFor, type UnitId } from "@/components/emblems";
import { TuneConsole } from "@/components/tune-console";
import { ActionBadge, Card, ClassTabs, Delta, Empty, Gauge, Metric, PageHeader, Skeleton, Table, Tag } from "@/components/ui";
import { dateTime, duration, pct, ratio, signedUsd } from "@/lib/format";
import { briefAttrs } from "@/lib/briefings";
import { getStrategies, parseClassFilter } from "@/lib/queries";

export const metadata: Metadata = { title: "Hangar" };

export default function HangarPage({ searchParams }: PageProps<"/strategies">) {
  return (
    <>
      <PageHeader
        code="SYS-04 // Hangar"
        title="Hangar"
        subtitle="Strategy units · loadout, combat record, targeting"
        scene={ART.hangar}
        scenePosition="center 18%"
        brief={briefAttrs("page-hangar")}
      />
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
            <section
              key={st.id}
              className="frame frame-hot boot"
              tabIndex={0}
              {...briefAttrs("unit", {
                unit: st.id,
                code: unit.code,
                role: unit.role,
                description: st.description,
                count: st.stats.count,
                winRate: st.stats.winRate === null ? "—" : pct(st.stats.winRate, 0),
                realized: signedUsd(st.stats.totalPnl),
                open: st.openPositions,
                symbols: st.symbols.join(", "),
              })}
            >
              <div className="frame-body relative overflow-hidden">
                {/* Unit key art, faded behind the stats */}
                <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1/2">
                  <Image
                    src={st.id === "sma_cross" ? ART.vanguardKeyart : ART.recoilKeyart}
                    alt=""
                    fill
                    sizes="(max-width: 1024px) 50vw, 25vw"
                    className="object-cover object-top opacity-25"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#0e0d14] to-transparent" />
                </div>
                {/* Unit color band */}
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ background: `linear-gradient(90deg, ${unit.primary}, ${unit.secondary})` }}
                />
                <div className="relative flex items-center gap-5 px-5 pt-5 pb-4">
                  <div className="relative size-32 shrink-0" style={{ filter: `drop-shadow(0 0 16px ${unit.primary}88)` }}>
                    <Image src={unitBust(st.id)} alt={`${unit.code} ${unit.callsign}`} fill sizes="128px" className="object-contain" />
                  </div>
                  <div className="min-w-0">
                    <div className="hud text-[12px]" style={{ color: unit.secondary }}>
                      {unit.code} · {unit.role}
                    </div>
                    <h2 className="mt-1 font-title text-[32px] leading-none font-extrabold text-ink">{unit.callsign}</h2>
                    <div className="hud mt-1.5 text-[13px] text-ink-2">{st.name}</div>
                  </div>
                </div>
                <p className="relative px-5 text-[14px] leading-relaxed text-ink-2">{st.description}</p>

                <div className="relative grid grid-cols-1 gap-3.5 px-5 pt-5">
                  <Gauge
                    label="Sync rate"
                    value={st.stats.winRate ?? 0}
                    readout={st.stats.winRate === null ? "—" : pct(st.stats.winRate, 0)}
                    color={unit.primary}
                    caption="Win rate on closed trades"
                    brief={briefAttrs("win-rate", {
                      scope: unit.callsign,
                      value: st.stats.winRate === null ? "—" : pct(st.stats.winRate, 0),
                      sub: `${st.stats.wins} won, ${st.stats.losses} lost`,
                      count: st.stats.count,
                    })}
                  />
                  <Gauge
                    label="Sorties flown"
                    value={Math.min(1, st.stats.count / 50)}
                    readout={st.stats.count}
                    color={unit.secondary}
                    caption="Closed trades (bar fills at 50)"
                    brief={briefAttrs("unit-sorties", { scope: unit.callsign, value: st.stats.count })}
                  />
                </div>

                <dl className="relative mt-5 grid grid-cols-3 gap-px border-t border-line bg-line">
                  {(
                    [
                      ["Realized", <Delta key="r" value={st.stats.totalPnl}>{signedUsd(st.stats.totalPnl)}</Delta>, "realized", signedUsd(st.stats.totalPnl)],
                      ["Unrealized", <Delta key="u" value={st.unrealizedPl}>{signedUsd(st.unrealizedPl)}</Delta>, "unrealized", signedUsd(st.unrealizedPl)],
                      ["Deployed", st.openPositions, "deployed", st.openPositions],
                      ["Profit factor", ratio(st.stats.profitFactor), "profit-factor", ratio(st.stats.profitFactor)],
                      ["Avg hold", duration(st.stats.avgHoldMs), "avg-hold", duration(st.stats.avgHoldMs)],
                      ["Expectancy", st.stats.expectancy === null ? "—" : signedUsd(st.stats.expectancy), "expectancy", st.stats.expectancy === null ? "—" : signedUsd(st.stats.expectancy)],
                    ] as const
                  ).map(([label, value, id, text]) => (
                    <div
                      key={label}
                      className="bg-surface px-5 py-3"
                      {...briefAttrs(id, { scope: unit.callsign, value: text, count: st.stats.count })}
                    >
                      <Metric label={label}>{value}</Metric>
                    </div>
                  ))}
                </dl>

                <div className="relative border-t border-line px-5 py-4">
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
        brief={briefAttrs("tune", {
          stop: `${(live.stopLossPct * 100).toFixed(1)}%`,
          stocks: live.stocksEnabled ? "armed" : "safed",
          crypto: live.cryptoEnabled ? "armed" : "safed",
        })}
      >
        <TuneConsole current={live} />
      </Card>

      <Card
        title="Targeting computer"
        subtitle="Latest evaluation of every target"
        code="TGT-01"
        brief={briefAttrs("targeting", { count: latest.length })}
      >
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
                <tr
                  key={s.id}
                  {...briefAttrs("signal", {
                    symbol: s.symbol,
                    unit: s.strategy,
                    action: s.action,
                    reason: s.note ?? s.reason,
                    telemetry: fmtIndicators(s.indicators),
                  })}
                >
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
          <Empty art={ART.awaiting}>Targeting comes online after the first sortie.</Empty>
        )}
      </Card>

      <Card
        title="Engagement orders"
        subtitle="Last 100 buy/sell calls, including ones blocked by risk limits"
        code="TGT-02"
        brief={briefAttrs("calls", { count: recent.length })}
      >
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
                <tr
                  key={s.id}
                  {...briefAttrs("call", {
                    symbol: s.symbol,
                    action: s.action,
                    reason: s.reason,
                    outcome: s.note ?? "—",
                    acted: s.acted,
                  })}
                >
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
