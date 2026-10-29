import { z } from "zod";
import * as alpaca from "./alpaca";
import { runBacktest, type BacktestResult } from "./backtest";
import {
  BAR_TIMEFRAME,
  BENCHMARKS,
  CORE,
  CRYPTO_FEES,
  CRYPTO_RISK,
  CRYPTO_SYMBOLS,
  MAX_STORED_SIM_TRADES,
  PORTFOLIO_RISK,
  RISK,
  STOCK_SYMBOLS,
  STRATEGY_PARAMS,
  UNIVERSE,
} from "./config";
import { tradingDay } from "./analytics";
import { regimeByDate } from "./core";
import { db, schema } from "./db";
import { isRegularSessionBar } from "./engine";
import { makeRsiRevert } from "./strategies/rsi-revert";
import { makeSmaCross } from "./strategies/sma-cross";
import type { Strategy } from "./strategies/types";

export const SimParams = z.object({
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]).default(3),
  theater: z.enum(["all", "us_equity", "crypto"]).default("all"),
  sma: z
    .object({
      fast: z.number().int().min(2).max(200),
      slow: z.number().int().min(3).max(400),
      crossLookback: z.number().int().min(1).max(20),
    })
    .refine((p) => p.fast < p.slow, "fast must be < slow")
    .default({ ...STRATEGY_PARAMS.sma_cross }),
  rsi: z
    .object({
      period: z.number().int().min(2).max(100),
      entry: z.number().min(1).max(99),
      exit: z.number().min(1).max(99),
    })
    .refine((p) => p.entry < p.exit, "entry must be < exit")
    .default({ ...STRATEGY_PARAMS.rsi_revert }),
  stopLossPct: z.number().min(0.005).max(0.5).default(RISK.stopLossPct),
  /** UNIT-00 Bastion. Off = units only (still gated by the 200-day market filter, like live). */
  core: z.object({ enabled: z.boolean(), pct: z.number().min(0.1).max(0.9) }).default({ enabled: true, pct: CORE.pct }),
  startEquity: z.number().min(1000).max(10_000_000).default(100_000),
});
export type SimParams = z.infer<typeof SimParams>;

export async function runSimulation(params: SimParams): Promise<{ id: number; result: BacktestResult; bars: number }> {
  const started = Date.now();
  const end = new Date();
  const start = new Date(end.getTime() - params.months * 30.44 * 86_400_000);

  const stocks = params.theater === "crypto" ? [] : STOCK_SYMBOLS;
  const coins = params.theater === "us_equity" ? [] : CRYPTO_SYMBOLS;

  const withCore = params.core.enabled && params.theater !== "crypto";
  const intraday = withCore ? [...stocks, CORE.symbol] : stocks;
  const [stockBars, cryptoBars, spyHistory, btcDaily] = await Promise.all([
    intraday.length ? alpaca.getBars(intraday, BAR_TIMEFRAME, start, end) : {},
    coins.length ? alpaca.getCryptoBars(coins, BAR_TIMEFRAME, start) : {},
    // Extra history so the 200-day market filter is ready on the first simulated day.
    alpaca.getBars([BENCHMARKS.us_equity], "1Day", new Date(start.getTime() - CORE.lookbackDays * 86_400_000), end),
    alpaca.getCryptoBars([BENCHMARKS.crypto], "1Day", start),
  ]);
  const spyDaily = { [BENCHMARKS.us_equity]: spyHistory[BENCHMARKS.us_equity]?.filter((b) => Date.parse(b.t) >= start.getTime()) ?? [] };
  const regime = regimeByDate((spyHistory[BENCHMARKS.us_equity] ?? []).map((b) => ({ date: tradingDay(new Date(b.t)), close: b.c })));

  // Same inputs the live bot sees: regular-session bars for stocks, all hours for crypto.
  const bars: Record<string, alpaca.Bar[]> = {};
  for (const s of intraday) bars[s] = (stockBars as Record<string, alpaca.Bar[]>)[s]?.filter((b) => isRegularSessionBar(b.t)) ?? [];
  for (const s of coins) bars[s] = (cryptoBars as Record<string, alpaca.Bar[]>)[s] ?? [];

  const sma = makeSmaCross(params.sma);
  const rsi = makeRsiRevert(params.rsi);
  const strategies: Record<string, Strategy> = {};
  for (const s of [...stocks, ...coins]) strategies[s] = UNIVERSE[s] === "sma_cross" ? sma : rsi;

  const result = runBacktest(
    bars,
    strategies,
    {
      startEquity: params.startEquity,
      stocks: { maxPositionPct: RISK.maxPositionPct, stopLossPct: params.stopLossPct },
      crypto: {
        maxPositionPct: CRYPTO_RISK.maxPositionPct,
        maxClassPct: CRYPTO_RISK.maxClassPct,
        stopLossPct: params.stopLossPct,
        feeRate: CRYPTO_FEES.cryptoSellFeeRate,
      },
      maxOpenPositions: PORTFOLIO_RISK.maxOpenPositions,
      dailyLossHaltPct: PORTFOLIO_RISK.dailyLossHaltPct,
      cooldownHours: PORTFOLIO_RISK.reentryCooldownHours,
      regime,
      ...(withCore ? { unitsMaxPct: 1 - params.core.pct, core: { id: CORE.id, symbol: CORE.symbol, pct: params.core.pct } } : {}),
    },
    { spy: spyDaily[BENCHMARKS.us_equity], btc: btcDaily[BENCHMARKS.crypto] },
  );

  const barCount = Object.values(bars).reduce((a, b) => a + b.length, 0);
  const stored = { ...result, trades: result.trades.slice(-MAX_STORED_SIM_TRADES) };
  const [row] = await db()
    .insert(schema.simulations)
    .values({
      params,
      summary: result.summary,
      result: stored,
      bars: barCount,
      durationMs: Date.now() - started,
    })
    .returning({ id: schema.simulations.id });
  return { id: row.id, result, bars: barCount };
}
