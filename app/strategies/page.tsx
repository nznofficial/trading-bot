import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { ART, unitBust } from "@/components/art";
import { UNITS, unitFor, type UnitId } from "@/components/emblems";
import { TuneConsole } from "@/components/tune-console";
import { ActionBadge, Card, ClassTabs, Delta, Empty, Gauge, Metric, PageHeader, Skeleton, StatusBadge, Table, Tag } from "@/components/ui";
import { dateTime, duration, pct, ratio, shortDate, signedPct, signedUsd } from "@/lib/format";
import { briefAttrs } from "@/lib/briefings";
import { HEALTH, type HealthStatus } from "@/lib/health";
import { getStrategies, getUnitHealth, parseClassFilter } from "@/lib/queries";

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
  const [{ live, strategies, latest, recent }, vanguardHealth, recoilHealth] = await Promise.all([
    getStrategies(filter),
    getUnitHealth("sma_cross", filter),
    getUnitHealth("rsi_revert", filter),
  ]);

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
                      unit: st.id,
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
                    brief={briefAttrs("unit-sorties", { scope: unit.callsign, unit: st.id, value: st.stats.count })}
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
                      {...briefAttrs(id, { scope: unit.callsign, unit: st.id, value: text, count: st.stats.count })}
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

      <HealthPanel unitId="sma_cross" code="HGR-02" {...vanguardHealth} />
      <HealthPanel unitId="rsi_revert" code="HGR-03" {...recoilHealth} />

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
          <Empty art={ART.awaitingLarge} cover position="45% 10%">Targeting comes online after the first sortie.</Empty>
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
                    unit: s.strategy,
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
          <Empty art={ART.noContactLarge} cover>No buy or sell calls yet. Units are holding.</Empty>
        )}
      </Card>
    </div>
  );
}

const STATUS_LABEL: Record<HealthStatus, string> = { ok: "Nominal", watch: "Watch", alert: "Breach", thin: "Too early" };
const VERDICT: Record<HealthStatus, string> = {
  ok: "Behaving like its backtest. Leave the tuning alone.",
  watch: "Drifting from its backtest. Keep watching; no change yet.",
  alert: "Outside its backtest. Re-validate in the Simulator (tune on older months, judge on the latest) before changing anything.",
  thin: "Not enough live trades yet to compare against the backtest.",
};

/** A unit's live record against the newest simulation on its live tuning. */
function HealthPanel({
  unitId,
  code,
  baseline,
  health,
}: Awaited<ReturnType<typeof getUnitHealth>> & { unitId: UnitId; code: string }) {
  const unit = UNITS[unitId];
  const title = `${unit.callsign} health`;
  if (!baseline || !health) {
    return (
      <Card title={title} code={code} brief={briefAttrs("unit-health", { unit: unitId, status: "—", run: "—" })}>
        <Empty art={ART.awaitingLarge} cover position="45% 10%">
          No baseline yet.{" "}
          <Link href="/simulator" className="text-amber underline underline-offset-4">
            Run a simulation
          </Link>{" "}
          on the live tuning and this panel compares against it.
        </Empty>
      </Card>
    );
  }
  const { drawdown, sharpe, expectancy, overall } = health;
  const fmt = (x: number | null, f: (n: number) => string) => (x === null ? "—" : f(x));
  // Drawdowns at one decimal: round first so a sliver of a loss reads 0.0%, not −0.0%.
  const ddPct = (x: number) => signedPct(Math.round(x * 1000) / 1000, 1);
  const checks = [
    {
      id: "health-drawdown",
      label: "Drawdown",
      status: drawdown.status,
      value: fmt(drawdown.live, ddPct),
      baseline: fmt(drawdown.baseline, ddPct),
      caption: `Worst live ${ddPct(drawdown.liveMax)} · amber at half the backtest's worst, red past it`,
      ctx: { max: ddPct(drawdown.liveMax) },
    },
    {
      id: "health-sharpe",
      label: `Sharpe · ${HEALTH.sharpeDays}d`,
      status: sharpe.status,
      value: ratio(sharpe.live),
      baseline: ratio(sharpe.baseline),
      caption: `${sharpe.days} days, ${sharpe.sample} trades closed · needs ${HEALTH.minSharpeDays} days`,
      ctx: { days: sharpe.days },
    },
    {
      id: "health-expectancy",
      label: `Expectancy · last ${HEALTH.expectancyTrades}`,
      status: expectancy.status,
      value: fmt(expectancy.live, (x) => signedPct(x, 2)),
      baseline: fmt(expectancy.baseline, (x) => signedPct(x, 2)),
      caption: `Avg return per trade over ${expectancy.sample} trades · needs ${HEALTH.minExpectancyTrades}`,
      ctx: {},
    },
  ] as const;

  return (
    <Card
      title={title}
      subtitle={`Live vs sim run #${baseline.id} · ${baseline.months} mo · ${shortDate(baseline.createdAt)}`}
      code={code}
      tone={overall === "alert" ? "hot" : overall === "watch" ? "amber" : undefined}
      action={<StatusBadge status={overall} label={STATUS_LABEL[overall]} />}
      brief={briefAttrs("unit-health", { unit: unitId, status: STATUS_LABEL[overall], run: `#${baseline.id}` })}
    >
      <div className="-mx-5 -mt-5 grid grid-cols-1 gap-px border-b border-line bg-line sm:grid-cols-3">
        {checks.map((c) => (
          <div
            key={c.id}
            className="bg-surface px-5 py-4"
            {...briefAttrs(c.id, {
              scope: unit.callsign,
              unit: unitId,
              value: c.value,
              baseline: c.baseline,
              status: STATUS_LABEL[c.status],
              sample: c.id === "health-expectancy" ? expectancy.sample : sharpe.sample,
              ...c.ctx,
            })}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="hud text-[12px] text-ink-2">{c.label}</span>
              <StatusBadge status={c.status} label={STATUS_LABEL[c.status]} />
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <span className="num text-[24px] text-ink">{c.value}</span>
              <span className="num text-[13px] text-muted">backtest {c.baseline}</span>
            </div>
            <div className="mt-1 text-[12px] text-muted">{c.caption}</div>
          </div>
        ))}
      </div>
      <p className="pt-4 text-[14px] text-ink-2">
        {VERDICT[overall]}{" "}
        <Link href={`/simulator?run=${baseline.id}`} className="text-amber underline underline-offset-4">
          Open baseline run
        </Link>
      </p>
    </Card>
  );
}
