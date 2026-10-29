import { drawdowns, sharpe, tradingDay } from "./analytics";
import type { StrategyId } from "./config";
import type { LiveParams } from "./live-params";
import type { ClassFilter } from "./queries";
import type { SimParams } from "./simulator";

/**
 * Unit health: is a unit still behaving like its backtest? Three checks compare live closed trades
 * with the same unit's trades in a simulation run on the live tuning:
 * - drawdown of the unit's realized-P&L curve vs the worst the backtest saw,
 * - rolling Sharpe of its daily realized P&L,
 * - rolling expectancy (average return per trade).
 * A breach means "re-validate in the Simulator", not "retune now".
 */

export type HealthStatus = "ok" | "watch" | "alert" | "thin";

/** Minimal closed-trade shape, so live round trips and stored simulator trades both fit. */
export type HealthTrade = {
  strategy: string;
  assetClass: string;
  entryTs: number;
  exitTs: number;
  pnl: number;
  returnPct: number;
};

export const HEALTH = {
  /** Rolling Sharpe window, calendar days. */
  sharpeDays: 90,
  /** Fewer days than this in the window and Sharpe is too noisy to judge. */
  minSharpeDays: 30,
  /** Rolling expectancy window, closed trades. */
  expectancyTrades: 25,
  minExpectancyTrades: 10,
  /** Amber once a reading falls to this fraction of the backtest's. */
  watchFraction: 0.5,
  /** Backtest drawdowns shallower than this are floored, so a lucky run doesn't flag every scratch. */
  minDrawdownLimit: -0.01,
} as const;

export type HealthCheck = { status: HealthStatus; live: number | null; baseline: number | null; sample: number };
export type UnitHealth = {
  drawdown: HealthCheck & { liveMax: number };
  sharpe: HealthCheck & { days: number };
  expectancy: HealthCheck;
  overall: HealthStatus;
};

const DAY = 86_400_000;

/** Every New York calendar day from `fromMs` to `toMs`, inclusive. */
function days(fromMs: number, toMs: number): string[] {
  const out = new Set<string>();
  for (let t = fromMs; t <= toMs; t += DAY) out.add(tradingDay(new Date(t)));
  out.add(tradingDay(new Date(toMs)));
  return [...out];
}

/** Daily realized P&L as a fraction of `base`, with zero for days nothing closed. */
export function dailyUnitReturns(trades: HealthTrade[], base: number, fromMs: number, toMs: number): number[] {
  const pnl = new Map<string, number>();
  for (const t of trades) {
    if (t.exitTs < fromMs || t.exitTs > toMs) continue;
    const d = tradingDay(new Date(t.exitTs));
    pnl.set(d, (pnl.get(d) ?? 0) + t.pnl);
  }
  return days(fromMs, toMs).map((d) => (pnl.get(d) ?? 0) / base);
}

/** Drawdown series of `base` plus cumulative realized P&L, in exit order. */
export function unitDrawdown(trades: HealthTrade[], base: number) {
  let equity = base;
  const points = [{ ts: new Date(0), equity: base }];
  for (const t of trades.slice().sort((a, b) => a.exitTs - b.exitTs)) {
    equity += t.pnl;
    points.push({ ts: new Date(t.exitTs), equity });
  }
  const dd = drawdowns(points);
  return { current: dd.series[dd.series.length - 1].dd, max: dd.max };
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Higher-is-better reading vs baseline: red at or below zero, amber below half the baseline. */
function grade(live: number | null, baseline: number | null): HealthStatus {
  if (live === null) return "thin";
  if (live <= 0) return "alert";
  if (baseline !== null && baseline > 0 && live < baseline * HEALTH.watchFraction) return "watch";
  return "ok";
}

/** Amber or red wins; otherwise any check without enough data keeps the verdict at "too early". */
function overallOf(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("alert")) return "alert";
  if (statuses.includes("watch")) return "watch";
  return statuses.includes("thin") ? "thin" : "ok";
}

export function unitHealth(input: {
  live: { trades: HealthTrade[]; base: number; since: number; now: number };
  baseline: { trades: HealthTrade[]; base: number; from: number; to: number };
}): UnitHealth {
  const { live, baseline } = input;
  const byExit = (xs: HealthTrade[]) => xs.slice().sort((a, b) => a.exitTs - b.exitTs);
  const liveTrades = byExit(live.trades);
  const baseTrades = byExit(baseline.trades);

  // Drawdown: the backtest's worst is the limit; halfway there is amber.
  const ldd = unitDrawdown(liveTrades, live.base);
  const bdd = unitDrawdown(baseTrades, baseline.base).max;
  const limit = Math.min(bdd, HEALTH.minDrawdownLimit);
  const ddStatus: HealthStatus = !liveTrades.length
    ? "thin"
    : ldd.current <= limit
      ? "alert"
      : ldd.current <= limit * HEALTH.watchFraction
        ? "watch"
        : "ok";

  // Rolling Sharpe over the last N days (or since launch), against the whole backtest window.
  const from = Math.max(live.since, live.now - HEALTH.sharpeDays * DAY);
  const liveDaily = dailyUnitReturns(liveTrades, live.base, from, live.now);
  const windowTrades = liveTrades.filter((t) => t.exitTs >= from).length;
  const liveSharpe = liveDaily.length >= HEALTH.minSharpeDays && windowTrades > 0 ? sharpe(liveDaily) : null;
  const baseSharpe = sharpe(dailyUnitReturns(baseTrades, baseline.base, baseline.from, baseline.to));

  // Rolling expectancy: average return of the last N closed trades.
  const recent = liveTrades.slice(-HEALTH.expectancyTrades);
  const liveExp = recent.length >= HEALTH.minExpectancyTrades ? avg(recent.map((t) => t.returnPct)) : null;
  const baseExp = avg(baseTrades.map((t) => t.returnPct));

  const drawdown = { status: ddStatus, live: liveTrades.length ? ldd.current : null, liveMax: ldd.max, baseline: bdd, sample: liveTrades.length };
  const sharpeCheck = { status: grade(liveSharpe, baseSharpe), live: liveSharpe, baseline: baseSharpe, sample: windowTrades, days: liveDaily.length };
  const expectancy = { status: grade(liveExp, baseExp), live: liveExp, baseline: baseExp, sample: recent.length };
  const overall = overallOf([drawdown.status, sharpeCheck.status, expectancy.status]);
  return { drawdown, sharpe: sharpeCheck, expectancy, overall };
}

/** A saved simulation that ran this unit's live tuning and covers the theater being viewed. */
export function matchesLive(params: SimParams, live: LiveParams, unit: StrategyId, filter: ClassFilter): boolean {
  const same =
    unit === "sma_cross"
      ? params.sma.fast === live.sma.fast && params.sma.slow === live.sma.slow && params.sma.crossLookback === live.sma.crossLookback
      : params.rsi.period === live.rsi.period && params.rsi.entry === live.rsi.entry && params.rsi.exit === live.rsi.exit;
  return (
    same &&
    Math.abs(params.stopLossPct - live.stopLossPct) < 1e-9 &&
    (filter === "all" || params.theater === "all" || params.theater === filter)
  );
}
