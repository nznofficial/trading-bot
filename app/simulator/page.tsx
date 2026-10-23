import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ART } from "@/components/art";
import { PerformanceChart, SymbolPnlChart } from "@/components/charts";
import { unitFor } from "@/components/emblems";
import { SimulatorConsole } from "@/components/simulator-console";
import { Card, Delta, Empty, PageHeader, Skeleton, StatStrip, Table } from "@/components/ui";
import { dateTime, duration, pct, ratio, signedPct, signedUsd, usd } from "@/lib/format";
import { getLiveSettings, getSimulations, type SimulationRow } from "@/lib/queries";

export default function SimulatorPage({ searchParams }: PageProps<"/simulator">) {
  return (
    <>
      <PageHeader
        code="SYS-06 // Simulator"
        title="Simulator"
        subtitle="Replay the units over real history before trusting them with the account"
        scene={ART.simdeck}
        scenePosition="center 8%"
      />
      <div className="grid grid-cols-1 gap-5">
        <Card title="Mission parameters" subtitle="Defaults are the live settings" code="SIM-01" tone="amber">
          <Suspense fallback={<Skeleton className="h-64" />}>
            <Console />
          </Suspense>
        </Card>
        <Suspense fallback={<Skeleton />}>
          <Results searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}

/** The console starts from whatever the live units run today (Hangar tuning). */
async function Console() {
  await connection();
  const live = await getLiveSettings();
  return (
    <SimulatorConsole
      defaults={{ months: 3, theater: "all", ...live.sma, ...live.rsi, stopLossPct: live.stopLossPct * 100 }}
    />
  );
}

const paramLine = (p: SimulationRow["params"]) =>
  `SMA ${p.sma.fast}/${p.sma.slow} ×${p.sma.crossLookback} · RSI ${p.rsi.period} <${p.rsi.entry}/>${p.rsi.exit} · stop ${(p.stopLossPct * 100).toFixed(1)}%`;
const theaterLabel = (t: string) => (t === "us_equity" ? "Equities" : t === "crypto" ? "Crypto" : "All");

async function Results({ searchParams }: { searchParams: PageProps<"/simulator">["searchParams"] }) {
  await connection();
  const runParam = Number((await searchParams).run);
  const { runs, selected } = await getSimulations(Number.isFinite(runParam) && runParam > 0 ? runParam : null);
  if (!selected) {
    return (
      <Card>
        <Empty art={ART.awaiting}>No simulations yet. Set parameters above and launch one.</Empty>
      </Card>
    );
  }
  const s = selected.summary;
  const r = selected.result;
  const first = r.equity[0];
  const last = r.equity.at(-1);
  const spyRet = first?.spy && last?.spy ? last.spy / first.spy - 1 : null;
  const btcRet = first?.btc && last?.btc ? last.btc / first.btc - 1 : null;
  const perf = r.equity.map((e) => ({
    date: e.date,
    portfolio: e.equity / s.startEquity - 1,
    spy: e.spy === null ? null : e.spy / s.startEquity - 1,
    btc: e.btc === null ? null : e.btc / s.startEquity - 1,
  }));

  return (
    <>
      <Card
        title={`Debrief · run #${selected.id}`}
        subtitle={`${selected.params.months} mo · ${theaterLabel(selected.params.theater)} · ${paramLine(selected.params)}`}
        code="SIM-02"
        tone="hot"
      >
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Versus label="Units" value={s.totalReturn} color="var(--series-1)" />
          <Versus label="SPY hold" value={spyRet} color="var(--series-2)" />
          <Versus label="BTC hold" value={btcRet} color="var(--series-3)" />
        </div>
        {perf.length > 1 ? <PerformanceChart data={perf} /> : <Empty>Not enough history in this run.</Empty>}
        <p className="mt-3 text-[12px] text-muted">
          {selected.bars.toLocaleString()} bars replayed in {(selected.durationMs / 1000).toFixed(1)}s ·{" "}
          {dateTime(selected.createdAt)} · fills at next bar open, stops on bar lows, 0.25% crypto fees each side.
        </p>
      </Card>

      <StatStrip
        cols={6}
        items={[
          { label: "Final equity", value: usd(s.endEquity), sub: `from ${usd(s.startEquity)}` },
          { label: "Max damage", value: pct(s.maxDrawdown), sub: "worst drawdown" },
          { label: "Sharpe", value: ratio(s.sharpe), sub: `Sortino ${ratio(s.sortino)}` },
          { label: "Sync rate", value: s.winRate === null ? "—" : pct(s.winRate, 0), sub: `${s.count} trades` },
          { label: "Profit factor", value: ratio(s.profitFactor), sub: `expectancy ${s.expectancy === null ? "—" : signedUsd(s.expectancy)}` },
          { label: "Fees paid", value: usd(s.feesPaid), sub: `avg exposure ${pct(s.exposureAvg, 0)}` },
        ]}
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Card title="Unit performance" code="SIM-03">
          <Table>
            <thead>
              <tr>
                <th>Unit</th>
                <th className="text-right!">Trades</th>
                <th className="text-right!">Win</th>
                <th className="text-right!">Net P&amp;L</th>
                <th className="text-right!">Fees</th>
                <th className="text-right!">Avg hold</th>
              </tr>
            </thead>
            <tbody>
              {r.byUnit.map((u) => {
                const unit = unitFor(u.strategy);
                return (
                  <tr key={u.strategy}>
                    <td className="hud whitespace-nowrap" style={{ color: unit?.secondary }}>
                      {unit ? `${unit.code} ${unit.callsign}` : u.strategy}
                    </td>
                    <td className="num text-right">{u.stats.count}</td>
                    <td className="num text-right">{u.stats.winRate === null ? "—" : pct(u.stats.winRate, 0)}</td>
                    <td className="num text-right">
                      <Delta value={u.stats.totalPnl}>{signedUsd(u.stats.totalPnl)}</Delta>
                    </td>
                    <td className="num text-right text-ink-2">{usd(u.feesPaid)}</td>
                    <td className="num text-right text-ink-2">{duration(u.stats.avgHoldMs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
        <Card title="Damage dealt by target" subtitle="Net P&L per symbol" code="SIM-04">
          {r.bySymbol.length ? <SymbolPnlChart data={r.bySymbol} /> : <Empty>No trades in this run.</Empty>}
        </Card>
      </div>

      <Card title="Compare runs" subtitle="Click a run to load its debrief" code="SIM-05">
        <Table>
          <thead>
            <tr>
              <th>#</th>
              <th>Period</th>
              <th>Settings</th>
              <th className="text-right!">Return</th>
              <th className="text-right!">Max DD</th>
              <th className="text-right!">Sharpe</th>
              <th className="text-right!">Win</th>
              <th className="text-right!">Trades</th>
              <th className="text-right!">Fees</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className={run.id === selected.id ? "bg-unit/10" : undefined}>
                <td>
                  <Link href={`/simulator?run=${run.id}`} className="num text-amber hover:underline">
                    {run.id}
                  </Link>
                </td>
                <td className="hud whitespace-nowrap text-[12px] text-ink-2">
                  {run.params.months} mo · {theaterLabel(run.params.theater)}
                </td>
                <td className="num text-[12px] whitespace-nowrap text-muted">{paramLine(run.params)}</td>
                <td className="num text-right">
                  <Delta value={run.summary.totalReturn}>{signedPct(run.summary.totalReturn)}</Delta>
                </td>
                <td className="num text-right">{pct(run.summary.maxDrawdown, 1)}</td>
                <td className="num text-right">{ratio(run.summary.sharpe)}</td>
                <td className="num text-right">{run.summary.winRate === null ? "—" : pct(run.summary.winRate, 0)}</td>
                <td className="num text-right">{run.summary.count}</td>
                <td className="num text-right text-ink-2">{usd(run.summary.feesPaid)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Simulated combat log" subtitle={`Latest ${Math.min(50, r.trades.length)} of ${s.count} trades`} code="SIM-06">
        {r.trades.length ? (
          <Table>
            <thead>
              <tr>
                <th>Closed</th>
                <th>Target</th>
                <th>Unit</th>
                <th>Exit</th>
                <th className="text-right!">Entry → Exit</th>
                <th className="text-right!">Result</th>
                <th className="text-right!">Held</th>
              </tr>
            </thead>
            <tbody>
              {r.trades
                .slice(-50)
                .reverse()
                .map((t, i) => (
                  <tr key={i}>
                    <td className="num whitespace-nowrap text-ink-2">{dateTime(Date.parse(t.exitTs))}</td>
                    <td className="num font-medium text-ink">{t.symbol}</td>
                    <td className="hud text-[12px] text-ink-2">{unitFor(t.strategy)?.code ?? t.strategy}</td>
                    <td className={`hud text-[12px] ${t.exitReason === "stop" ? "text-alert" : "text-ink-2"}`}>{t.exitReason}</td>
                    <td className="num text-right whitespace-nowrap">
                      {usd(t.entryPrice)} → {usd(t.exitPrice)}
                    </td>
                    <td className="num text-right whitespace-nowrap">
                      <Delta value={t.pnl}>
                        {signedUsd(t.pnl)} ({signedPct(t.returnPct)})
                      </Delta>
                    </td>
                    <td className="num text-right text-ink-2">{duration(t.holdMs)}</td>
                  </tr>
                ))}
            </tbody>
          </Table>
        ) : (
          <Empty>No trades in this run.</Empty>
        )}
      </Card>
    </>
  );
}

function Versus({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="slant border border-line-2 bg-surface-2/60 px-3 py-2.5">
      <div className="unslant">
        <div className="hud text-[12px]" style={{ color }}>
          {label}
        </div>
        <div className="num mt-0.5 text-[22px]">
          {value === null ? "—" : <Delta value={value}>{signedPct(value)}</Delta>}
        </div>
      </div>
    </div>
  );
}
