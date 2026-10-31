import type { Bar } from "./alpaca";
import { drawdowns, pctReturns, sharpe, sortino, tradeStats, tradingDay, type RoundTrip, type TradeStats } from "./analytics";
import { assetClassOf, BAR_MINUTES, HERALD, type AssetClass, type OwnerId } from "./config";
import { heraldCall, isHeraldTrigger, isVeto, type GateParams, type HeraldParams, type ScoredHeadline } from "./news";
import type { Evaluator, Strategy } from "./strategies/types";

/**
 * Bar-by-bar simulation of the live bot's rules, so parameter choices can be judged on history.
 *
 * Fidelity rules (no look-ahead):
 * - A signal is computed on a bar's close; the order fills at the NEXT bar's open.
 * - Protective stops trigger when a bar's low reaches the stop; a gap below fills at the open.
 * - Same sizing and limits as live: per-position %, crypto class cap, max positions, daily loss halt,
 *   re-entry cooldown after a stop, whole shares for stocks, 0.25% crypto fees each side.
 * - With a market filter (`regime`), units don't open new positions on days it's false.
 * - With a core: it holds its symbol at `pct` of equity while `regime(day)` is true (decided on a bar's
 *   close, filled at the next open, like the units), sells when false, has no stop, and ignores the daily
 *   loss halt and cooldown. The units share whatever `unitsMaxPct` allows.
 * - With news (`news`): a headline counts at a bar only if it was published by that bar's close. The gate
 *   blocks unit buys in a vetoed symbol and lifts an open position's stop to `tightenPct` under the close
 *   (never lowering it). Herald buys its symbols on fresh qualifying headlines and sells `holdDays` trading
 *   days after the latest one, inside its own `pct` slice, with the normal stop; it obeys the market filter,
 *   the daily loss halt and cooldowns like the units, but not the units' position cap.
 */

export type BacktestConfig = {
  startEquity: number;
  stocks: { maxPositionPct: number; stopLossPct: number };
  crypto: { maxPositionPct: number; maxClassPct: number; stopLossPct: number; feeRate: number };
  maxOpenPositions: number;
  dailyLossHaltPct: number;
  cooldownHours: number;
  /** Cap on all unit (non-core) positions together, as a fraction of equity. Omitted = no cap. */
  unitsMaxPct?: number;
  /** Market filter: false on days SPY's last close is below its 200-day average. Gates unit buys and drives the core. */
  regime?: (day: string) => boolean | null;
  /** Requires `regime`. */
  core?: { id: OwnerId; symbol: string; pct: number };
  /** Scored headlines for the window, plus the gate and Herald settings (either may be off). */
  news?: {
    headlines: ScoredHeadline[];
    gate: (GateParams & { enabled: boolean }) | null;
    herald: (HeraldParams & { enabled: boolean; pct: number; maxPositions: number; symbols: string[] }) | null;
  };
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
  /** What the news layer did (present when `news` was configured). */
  news?: { buysBlocked: number; stopsLifted: number; heraldSignals: number };
};

type Position = {
  qty: number;
  entryPrice: number;
  /** Cash paid including any fee, for P&L. */
  cost: number;
  entryFee: number;
  entryTs: Date;
  /** 0 = no protective stop (the core). */
  stop: number;
  strategy: OwnerId;
};

type Pending = { action: "buy" | "sell"; strategy: OwnerId };

export function runBacktest(
  bars: Record<string, Bar[]>,
  strategies: Record<string, Strategy>,
  cfg: BacktestConfig,
  benchmarks: { spy?: Bar[]; btc?: Bar[] } = {},
): BacktestResult {
  const core = cfg.core && cfg.regime && (bars[cfg.core.symbol]?.length ?? 0) > 0 ? cfg.core : null;
  const regime = cfg.regime ?? (() => null);
  const unitSymbols = Object.keys(strategies).filter((s) => (bars[s]?.length ?? 0) > 0 && s !== core?.symbol);
  const herald = cfg.news?.herald?.enabled ? cfg.news.herald : null;
  const gate = cfg.news?.gate?.enabled ? cfg.news.gate : null;
  const heraldSymbols = herald
    ? herald.symbols.filter((s) => (bars[s]?.length ?? 0) > 0 && s !== core?.symbol && !unitSymbols.includes(s))
    : [];
  const heraldSet = new Set(heraldSymbols);
  const symbols = [...unitSymbols, ...heraldSymbols, ...(core ? [core.symbol] : [])];
  const barMs = BAR_MINUTES * 60_000;
  // Per-symbol headline lists, oldest first: vetoes for the gate, qualifying ones for Herald.
  const bySymbol = (keep: (h: ScoredHeadline) => boolean) => {
    const m = new Map<string, ScoredHeadline[]>();
    for (const h of cfg.news?.headlines ?? []) if (keep(h)) (m.get(h.symbol) ?? m.set(h.symbol, []).get(h.symbol)!).push(h);
    for (const list of m.values()) list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return m;
  };
  const vetoList = gate ? bySymbol((h) => isVeto(h, gate)) : new Map<string, ScoredHeadline[]>();
  const triggerList = herald ? bySymbol((h) => heraldSet.has(h.symbol) && isHeraldTrigger(h, herald)) : new Map<string, ScoredHeadline[]>();
  /** The veto in force at `closeMs`, if any. */
  const vetoAt = (symbol: string, closeMs: number) =>
    vetoList.get(symbol)?.findLast((h) => h.createdAt.getTime() <= closeMs && h.createdAt.getTime() + gate!.vetoHours * 3_600_000 > closeMs);
  const liftedFor = new Set<string>();
  const newsStats = { buysBlocked: 0, stopsLifted: 0, heraldSignals: 0 };
  const evaluators = new Map<string, Evaluator>(unitSymbols.map((s) => [s, strategies[s].prepare(bars[s])]));
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
  // Trading-day index for Herald's hold count.
  const sessions = [...new Set(clock.map((t) => tradingDay(new Date(t))))];
  const sessionIdx = (day: string) => {
    let lo = 0;
    let hi = sessions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sessions[mid] < day) lo = mid + 1;
      else hi = mid;
    }
    return lo; // first session on or after `day`
  };

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

  const openCore = (symbol: string, price: number, ts: Date, equity: number) => {
    const qty = Math.floor(Math.min(equity * core!.pct, cash * 0.95) / price);
    if (qty < 1) return;
    cash -= qty * price;
    positions.set(symbol, { qty, entryPrice: price, cost: qty * price, entryFee: 0, entryTs: ts, stop: 0, strategy: core!.id });
  };

  const openHerald = (symbol: string, price: number, ts: Date, equity: number) => {
    if ((cooldownUntil.get(symbol) ?? 0) > ts.getTime()) return;
    if (equity / dayStartEquity - 1 <= cfg.dailyLossHaltPct) return;
    let exposure = 0;
    let count = 0;
    for (const [s, p] of positions)
      if (heraldSet.has(s)) {
        exposure += p.qty * (lastClose.get(s) ?? p.entryPrice);
        count++;
      }
    if (count >= herald!.maxPositions) return;
    const budget = Math.min((equity * herald!.pct) / herald!.maxPositions, equity * herald!.pct - exposure, cash * 0.95);
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
      strategy: HERALD.id,
    });
  };

  const open = (symbol: string, price: number, ts: Date, strategy: OwnerId, equity: number) => {
    let unitCount = 0;
    for (const s of positions.keys()) if (!heraldSet.has(s)) unitCount++;
    if (unitCount >= cfg.maxOpenPositions) return;
    if ((cooldownUntil.get(symbol) ?? 0) > ts.getTime()) return;
    if (equity / dayStartEquity - 1 <= cfg.dailyLossHaltPct) return;
    let unitsExposure = 0;
    for (const [s, p] of positions) if (s !== core?.symbol && !heraldSet.has(s)) unitsExposure += p.qty * (lastClose.get(s) ?? p.entryPrice);
    const unitsRoom = equity * (cfg.unitsMaxPct ?? Infinity) - unitsExposure;
    const cls: AssetClass = assetClassOf(symbol);
    if (cls === "crypto") {
      let cryptoExposure = 0;
      for (const [s, p] of positions) if (assetClassOf(s) === "crypto") cryptoExposure += p.qty * (lastClose.get(s) ?? p.entryPrice);
      const budget = Math.min(equity * cfg.crypto.maxPositionPct, equity * cfg.crypto.maxClassPct - cryptoExposure, unitsRoom, cash * 0.95);
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
      const budget = Math.min(equity * cfg.stocks.maxPositionPct, unitsRoom, cash * 0.95);
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
        if (order.action === "buy" && !positions.has(symbol)) {
          if (symbol === core?.symbol) openCore(symbol, bar.o, ts, markEquity().equity);
          else if (heraldSet.has(symbol)) openHerald(symbol, bar.o, ts, markEquity().equity);
          else open(symbol, bar.o, ts, order.strategy, markEquity().equity);
        }
      }
      // 2) Protective stop: triggered by the bar's low; a gap through the stop fills at the open.
      const pos = positions.get(symbol);
      if (pos && pos.stop > 0 && bar.l <= pos.stop) close(symbol, Math.min(bar.o, pos.stop), ts, "stop");
      lastClose.set(symbol, bar.c);
      // 3) Evaluate on the close; act on the next bar.
      if (symbol === core?.symbol) {
        const above = regime(today);
        const holding = positions.has(symbol);
        if (above === true && !holding) pending.set(symbol, { action: "buy", strategy: core.id });
        else if (above === false && holding) pending.set(symbol, { action: "sell", strategy: core.id });
        continue;
      }
      const closeMs = t + barMs;
      // News gate: a fresh veto lifts the stop of an open position (once per headline).
      const veto = gate ? vetoAt(symbol, closeMs) : undefined;
      const held = positions.get(symbol);
      if (veto && held && held.stop > 0) {
        const key = `${veto.newsId}:${symbol}`;
        if (!liftedFor.has(key)) {
          liftedFor.add(key);
          const target = bar.c * (1 - gate!.tightenPct);
          if (target > held.stop && target < bar.c) {
            held.stop = target;
            newsStats.stopsLifted++;
          }
        }
      }
      if (heraldSet.has(symbol)) {
        const call = heraldCall({
          triggers: triggerList.get(symbol) ?? [],
          held: !!held,
          prevClose: i > 0 ? new Date(Date.parse(bars[symbol][i - 1].t) + barMs) : null,
          now: new Date(closeMs),
          holdDays: herald!.holdDays,
          tradingDaysSince: (h) => sessionIdx(today) - sessionIdx(tradingDay(h)),
        });
        if (call.action === "buy") {
          newsStats.heraldSignals++;
          if (regime(today) === false) continue;
          if (veto) {
            newsStats.buysBlocked++;
            continue;
          }
        }
        if (call.action !== "hold") pending.set(symbol, { action: call.action, strategy: HERALD.id });
        continue;
      }
      const sig = evaluators.get(symbol)!(i, positions.get(symbol)?.qty ?? 0);
      if (sig.action === "buy" && regime(today) === false) continue;
      if (sig.action === "buy" && veto && !positions.has(symbol)) {
        newsStats.buysBlocked++;
        continue;
      }
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
  const unitIds: OwnerId[] = [
    ...(core ? [core.id] : []),
    ...new Set(unitSymbols.map((s) => strategies[s].id)),
    ...(herald ? [HERALD.id] : []),
  ];

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
    ...(cfg.news ? { news: newsStats } : {}),
  };
}
