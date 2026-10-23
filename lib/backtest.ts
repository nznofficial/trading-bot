import type { Bar } from "./alpaca";
import { drawdowns, pctReturns, sharpe, sortino, tradeStats, tradingDay, type RoundTrip, type TradeStats } from "./analytics";
import { assetClassOf, type AssetClass, type StrategyId } from "./config";
import type { Evaluator, Strategy } from "./strategies/types";

/**
 * Bar-by-bar simulation of the live bot's rules, so parameter choices can be judged on history.
 *
 * Fidelity rules (no look-ahead):
 * - A signal is computed on a bar's close; the order fills at the NEXT bar's open.
 * - Protective stops trigger when a bar's low reaches the stop; a gap below fills at the open.
 * - Same sizing and limits as live: per-position %, crypto class cap, max positions, daily loss halt,
 *   re-entry cooldown after a stop, whole shares for stocks, 0.25% crypto fees each side.
 */

export type BacktestConfig = {
  startEquity: number;
  stocks: { maxPositionPct: number; stopLossPct: number };
  crypto: { maxPositionPct: number; maxClassPct: number; stopLossPct: number; feeRate: number };
  maxOpenPositions: number;
  dailyLossHaltPct: number;
  cooldownHours: number;
};

export type SimTrade = RoundTrip & { exitReason: "signal" | "stop" | "end" };

export type BacktestResult = {
  summary: {
    startEquity: number;
    endEquity: number;
    totalReturn: number;
    maxDrawdown: number;
    sharpe: number | null;
    sortino: number | null;
    days: number;
    feesPaid: number;
    exposureAvg: number;
  } & TradeStats;
  /** Daily closing equity, plus buy-and-hold benchmarks indexed to the same start. */
  equity: { date: string; equity: number; spy: number | null; btc: number | null }[];
  byUnit: { strategy: string; stats: TradeStats; feesPaid: number }[];
  bySymbol: { symbol: string; pnl: number; count: number }[];
  trades: SimTrade[];
};

type Position = {
  qty: number;
  entryPrice: number;
  /** Cash paid including any fee, for P&L. */
  cost: number;
  entryFee: number;
  entryTs: Date;
  stop: number;
  strategy: StrategyId;
};

type Pending = { action: "buy" | "sell"; strategy: StrategyId };

export function runBacktest(
  bars: Record<string, Bar[]>,
  strategies: Record<string, Strategy>,
  cfg: BacktestConfig,
  benchmarks: { spy?: Bar[]; btc?: Bar[] } = {},
): BacktestResult {
  const symbols = Object.keys(strategies).filter((s) => (bars[s]?.length ?? 0) > 0);
  const evaluators = new Map<string, Evaluator>(symbols.map((s) => [s, strategies[s].prepare(bars[s])]));
  // Merge every bar timestamp into one clock.
  const steps = new Map<number, { symbol: string; i: number }[]>();
  for (const s of symbols) {
    bars[s].forEach((b, i) => {
      const t = Date.parse(b.t);
      const list = steps.get(t) ?? [];
      list.push({ symbol: s, i });
      steps.set(t, list);
    });
  }
  const clock = [...steps.keys()].sort((a, b) => a - b);

  let cash = cfg.startEquity;
  const positions = new Map<string, Position>();
  const pending = new Map<string, Pending>();
  const lastClose = new Map<string, number>();
  const cooldownUntil = new Map<string, number>();
  const trades: SimTrade[] = [];
  const marks: { ts: Date; equity: number; exposure: number }[] = [];
  let dayKey = "";
  let dayStartEquity = cfg.startEquity;

  const markEquity = () => {
    let exposure = 0;
    for (const [s, p] of positions) exposure += p.qty * (lastClose.get(s) ?? p.entryPrice);
    return { equity: cash + exposure, exposure };
  };

  const close = (symbol: string, price: number, ts: Date, reason: SimTrade["exitReason"]) => {
    const p = positions.get(symbol)!;
    const cls = assetClassOf(symbol);
    const gross = p.qty * price;
    const exitFee = cls === "crypto" ? gross * cfg.crypto.feeRate : 0;
    cash += gross - exitFee;
    const pnl = gross - exitFee - p.cost;
    trades.push({
      symbol,
      assetClass: cls,
      entryOrderId: "",
      exitOrderId: "",
      strategy: p.strategy,
      entryTs: p.entryTs,
      exitTs: ts,
      qty: p.qty,
      entryPrice: p.entryPrice,
      exitPrice: price,
      pnl,
      fees: p.entryFee + exitFee,
      returnPct: p.cost > 0 ? pnl / p.cost : 0,
      holdMs: ts.getTime() - p.entryTs.getTime(),
      exitReason: reason,
    });
    positions.delete(symbol);
    if (reason === "stop") cooldownUntil.set(symbol, ts.getTime() + cfg.cooldownHours * 3_600_000);
  };

  const open = (symbol: string, price: number, ts: Date, strategy: StrategyId, equity: number) => {
    if (positions.size >= cfg.maxOpenPositions) return;
    if ((cooldownUntil.get(symbol) ?? 0) > ts.getTime()) return;
    if (equity / dayStartEquity - 1 <= cfg.dailyLossHaltPct) return;
    const cls: AssetClass = assetClassOf(symbol);
    if (cls === "crypto") {
      let cryptoExposure = 0;
      for (const [s, p] of positions) if (assetClassOf(s) === "crypto") cryptoExposure += p.qty * (lastClose.get(s) ?? p.entryPrice);
      const budget = Math.min(equity * cfg.crypto.maxPositionPct, equity * cfg.crypto.maxClassPct - cryptoExposure, cash * 0.95);
      if (budget < 10) return;
      const fill = Math.floor((budget / price) * 1e9) / 1e9;
      const received = fill * (1 - cfg.crypto.feeRate); // fee taken in-kind
      cash -= fill * price;
      positions.set(symbol, {
        qty: received,
        entryPrice: price,
        cost: fill * price,
        entryFee: (fill - received) * price,
        entryTs: ts,
        stop: price * (1 - cfg.crypto.stopLossPct),
        strategy,
      });
    } else {
      const budget = Math.min(equity * cfg.stocks.maxPositionPct, cash * 0.95);
      const qty = Math.floor(budget / price);
      if (qty < 1) return;
      cash -= qty * price;
      positions.set(symbol, {
        qty,
        entryPrice: price,
        cost: qty * price,
        entryFee: 0,
        entryTs: ts,
        stop: price * (1 - cfg.stocks.stopLossPct),
        strategy,
      });
    }
  };

  for (const t of clock) {
    const ts = new Date(t);
    const today = tradingDay(ts);
    if (today !== dayKey) {
      dayKey = today;
      dayStartEquity = markEquity().equity;
    }
    for (const { symbol, i } of steps.get(t)!) {
      const bar = bars[symbol][i];
      // 1) Orders decided on the previous bar fill at this bar's open.
      const order = pending.get(symbol);
      if (order) {
        pending.delete(symbol);
        if (order.action === "sell" && positions.has(symbol)) close(symbol, bar.o, ts, "signal");
        if (order.action === "buy" && !positions.has(symbol)) open(symbol, bar.o, ts, order.strategy, markEquity().equity);
      }
      // 2) Protective stop: triggered by the bar's low; a gap through the stop fills at the open.
      const pos = positions.get(symbol);
      if (pos && bar.l <= pos.stop) close(symbol, Math.min(bar.o, pos.stop), ts, "stop");
      lastClose.set(symbol, bar.c);
      // 3) Evaluate on the close; act on the next bar.
      const sig = evaluators.get(symbol)!(i, positions.get(symbol)?.qty ?? 0);
      if (sig.action !== "hold") pending.set(symbol, { action: sig.action, strategy: strategies[symbol].id });
    }
    const m = markEquity();
    marks.push({ ts, equity: m.equity, exposure: m.equity > 0 ? m.exposure / m.equity : 0 });
  }

  // Close anything still open at the last price so the summary reflects realized results.
  const endTs = new Date(clock.at(-1) ?? Date.now());
  for (const s of [...positions.keys()]) close(s, lastClose.get(s)!, endTs, "end");
  const endEquity = cash;
  if (marks.length) marks[marks.length - 1].equity = endEquity;

  // Daily series + benchmarks indexed to the first day.
  const daily = new Map<string, number>();
  for (const m of marks) daily.set(tradingDay(m.ts), m.equity);
  const benchDaily = (b?: Bar[]) => {
    const map = new Map<string, number>();
    for (const x of b ?? []) map.set(tradingDay(new Date(x.t)), x.c);
    return map;
  };
  const spyMap = benchDaily(benchmarks.spy);
  const btcMap = benchDaily(benchmarks.btc);
  const dates = [...daily.keys()];
  const firstOf = (map: Map<string, number>) => dates.map((d) => map.get(d)).find((v) => v !== undefined) ?? null;
  const spy0 = firstOf(spyMap);
  const btc0 = firstOf(btcMap);
  let spyLast: number | null = spy0;
  let btcLast: number | null = btc0;
  const equity = dates.map((date) => {
    spyLast = spyMap.get(date) ?? spyLast;
    btcLast = btcMap.get(date) ?? btcLast;
    return {
      date,
      equity: daily.get(date)!,
      spy: spy0 && spyLast ? (spyLast / spy0) * cfg.startEquity : null,
      btc: btc0 && btcLast ? (btcLast / btc0) * cfg.startEquity : null,
    };
  });

  const returns = pctReturns(equity.map((e) => e.equity));
  const dd = drawdowns(marks.map((m) => ({ ts: m.ts, equity: m.equity })));
  const feesPaid = trades.reduce((a, t) => a + t.fees, 0);
  const bySymbolMap = new Map<string, { symbol: string; pnl: number; count: number }>();
  for (const t of trades) {
    const x = bySymbolMap.get(t.symbol) ?? { symbol: t.symbol, pnl: 0, count: 0 };
    x.pnl += t.pnl;
    x.count++;
    bySymbolMap.set(t.symbol, x);
  }
  const unitIds = [...new Set(Object.values(strategies).map((s) => s.id))];

  return {
    summary: {
      startEquity: cfg.startEquity,
      endEquity,
      totalReturn: endEquity / cfg.startEquity - 1,
      maxDrawdown: dd.max,
      sharpe: sharpe(returns),
      sortino: sortino(returns),
      days: equity.length,
      feesPaid,
      exposureAvg: marks.length ? marks.reduce((a, m) => a + m.exposure, 0) / marks.length : 0,
      ...tradeStats(trades),
    },
    equity,
    byUnit: unitIds.map((id) => {
      const mine = trades.filter((t) => t.strategy === id);
      return { strategy: id, stats: tradeStats(mine), feesPaid: mine.reduce((a, t) => a + t.fees, 0) };
    }),
    bySymbol: [...bySymbolMap.values()].sort((a, b) => b.pnl - a.pnl),
    trades,
  };
}
