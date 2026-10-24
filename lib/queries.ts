import { and, asc, count, desc, eq, gte, ne, type SQL } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import {
  aggregateFills,
  dailyCloses,
  downsample,
  drawdowns,
  matchRoundTrips,
  pctReturns,
  sharpe,
  sortino,
  tradeStats,
  type RoundTrip,
} from "./analytics";
import { assetClassOf, BENCHMARKS, CRYPTO_FEES, UNIVERSE, type AssetClass } from "./config";
import { db, schema } from "./db";
import type { Quote } from "./quotes";
import { buildUnits, getLiveParams } from "./live-params";
import { UNITS as UNITS_BY_ID } from "./units";

export type ClassFilter = "all" | AssetClass;

export function parseClassFilter(v: string | string[] | undefined): ClassFilter {
  return v === "us_equity" || v === "crypto" ? v : "all";
}

/**
 * All dashboard reads are cached briefly and tagged "bot"; each tick revalidates the tag.
 * An expire under 5 minutes keeps these out of the build-time prerender, so the build never needs the DB.
 */
function botCache() {
  cacheTag("bot");
  cacheLife({ stale: 30, revalidate: 60, expire: 120 });
}

const ms = (d: Date | null) => (d ? d.getTime() : null);
const matches = (filter: ClassFilter, cls: string) => filter === "all" || filter === cls;

export type SerializedTrade = Omit<RoundTrip, "entryTs" | "exitTs"> & { entryTs: number; exitTs: number };

async function loadTrades() {
  const d = db();
  const [fillRows, orderRows, feeRows] = await Promise.all([
    d.select().from(schema.fills).orderBy(asc(schema.fills.ts)),
    d.select({ id: schema.orders.id, strategy: schema.orders.strategy }).from(schema.orders),
    d.select().from(schema.fees),
  ]);
  const strategyByOrder = new Map(orderRows.filter((o) => o.strategy).map((o) => [o.id, o.strategy!]));
  const { trades, openLots } = matchRoundTrips(aggregateFills(fillRows, strategyByOrder), CRYPTO_FEES);
  // Fees: those attributed to closed trades (crypto fee model) plus any CFEE activities Alpaca reports
  // (live accounts; paper accounts report none, so nothing is double counted there).
  const fees = [
    ...trades.filter((t) => t.fees > 0).map((t) => ({ symbol: t.symbol, assetClass: t.assetClass, amount: t.fees })),
    ...feeRows.map((f) => ({ symbol: f.symbol, assetClass: f.assetClass as AssetClass, amount: f.amountUsd })),
  ];
  return { trades, openLots, fees };
}

const serializeTrade = (t: RoundTrip): SerializedTrade => ({
  ...t,
  entryTs: t.entryTs.getTime(),
  exitTs: t.exitTs.getTime(),
});

async function loadPositions() {
  const d = db();
  const [latest] = await d
    .select({ runId: schema.equitySnapshots.runId, ts: schema.equitySnapshots.ts })
    .from(schema.equitySnapshots)
    .orderBy(desc(schema.equitySnapshots.id))
    .limit(1);
  if (!latest) return { asOf: null, positions: [] };
  const rows = await d
    .select()
    .from(schema.positionsSnapshot)
    .where(eq(schema.positionsSnapshot.runId, latest.runId))
    .orderBy(desc(schema.positionsSnapshot.marketValue));
  return {
    asOf: latest.ts.getTime(),
    positions: rows.map((p) => ({
      symbol: p.symbol,
      assetClass: p.assetClass as AssetClass,
      qty: p.qty,
      avgEntry: p.avgEntry,
      currentPrice: p.currentPrice,
      marketValue: p.marketValue,
      unrealizedPl: p.unrealizedPl,
      unrealizedPlpc: p.unrealizedPlpc,
      strategy: UNIVERSE[p.symbol] ?? "manual",
    })),
  };
}

export async function getOverview() {
  "use cache";
  botCache();
  const d = db();
  const [snaps, bench, [lastRun], [paused], { trades, fees }, { positions }] = await Promise.all([
    d.select().from(schema.equitySnapshots).orderBy(asc(schema.equitySnapshots.ts)),
    d.select().from(schema.benchmarkCloses).orderBy(asc(schema.benchmarkCloses.date)),
    d.select().from(schema.botRuns).orderBy(desc(schema.botRuns.id)).limit(1),
    d.select().from(schema.settings).where(eq(schema.settings.key, "paused")),
    loadTrades(),
    loadPositions(),
  ]);

  const points = snaps.map((s) => ({ ts: s.ts, equity: s.equity }));
  const daily = dailyCloses(points);
  const returns = pctReturns(daily.map((p) => p.equity));
  const dd = drawdowns(points);
  const first = snaps[0];
  const latest = snaps[snaps.length - 1];

  // Portfolio vs each benchmark, as % return since the first day we have equity for.
  const startDate = daily[0]?.date;
  const benchSeries = (symbol: string) => {
    const rows = bench.filter((b) => b.symbol === symbol);
    const byDate = new Map(rows.map((b) => [b.date, b.close]));
    const base = startDate
      ? (rows.find((b) => b.date === startDate) ?? rows.findLast((b) => b.date < startDate))?.close
      : undefined;
    let last = base;
    return (date: string) => {
      last = byDate.get(date) ?? last;
      return base && last ? last / base - 1 : null;
    };
  };
  const spy = benchSeries(BENCHMARKS.us_equity);
  const btc = benchSeries(BENCHMARKS.crypto);
  const performance = daily.map((p) => ({
    date: p.date,
    portfolio: first ? p.equity / first.equity - 1 : 0,
    spy: spy(p.date),
    btc: btc(p.date),
  }));

  const byClass = (cls: AssetClass) => {
    const t = trades.filter((x) => x.assetClass === cls);
    const pos = positions.filter((p) => p.assetClass === cls);
    const stats = tradeStats(t);
    const feeTotal = fees.filter((f) => f.assetClass === cls).reduce((a, f) => a + f.amount, 0);
    return {
      realized: stats.totalPnl,
      fees: feeTotal,
      unrealized: pos.reduce((a, p) => a + p.unrealizedPl, 0),
      exposure: pos.reduce((a, p) => a + p.marketValue, 0),
      openPositions: pos.length,
      trades: stats.count,
      winRate: stats.winRate,
    };
  };

  const unrealized = positions.reduce((a, p) => a + p.unrealizedPl, 0);
  const stats = tradeStats(trades);

  // Consecutive winning trades, counted back from the most recent exit.
  const byExit = trades.slice().sort((a, b) => a.exitTs.getTime() - b.exitTs.getTime());
  let streak = 0;
  for (let i = byExit.length - 1; i >= 0 && byExit[i].pnl > 0; i--) streak++;
  // Headline-worthy win: a trade closed in the last 24h that returned at least 2%.
  const dayAgo = (latest?.ts.getTime() ?? 0) - 86_400_000;
  const bigWin = byExit.filter((t) => t.exitTs.getTime() >= dayAgo && t.returnPct >= 0.02).at(-1) ?? null;
  const totalFees = fees.reduce((a, f) => a + f.amount, 0);

  return {
    hasData: snaps.length > 0,
    paused: paused?.value === true,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          status: lastRun.status,
          startedAt: lastRun.startedAt.getTime(),
          marketOpen: lastRun.marketOpen,
          message: lastRun.message,
          error: lastRun.error,
        }
      : null,
    kpis: latest
      ? {
          equity: latest.equity,
          startEquity: first.equity,
          totalReturn: latest.equity / first.equity - 1,
          dayPnl: latest.equity - latest.lastEquity,
          dayPnlPct: latest.lastEquity ? latest.equity / latest.lastEquity - 1 : 0,
          cash: latest.cash,
          exposure: latest.equity ? latest.longMarketValue / latest.equity : 0,
          maxDrawdown: dd.max,
          currentDrawdown: dd.series[dd.series.length - 1]?.dd ?? 0,
          sharpe: sharpe(returns),
          sortino: sortino(returns),
          days: daily.length,
          realizedPnl: stats.totalPnl,
          fees: totalFees,
          unrealizedPnl: unrealized,
          openPositions: positions.length,
          since: first.ts.getTime(),
        }
      : null,
    classes: { us_equity: byClass("us_equity"), crypto: byClass("crypto") },
    stats,
    // Charts get a thinned series (metrics above use every snapshot).
    equity: downsample(
      snaps.map((s) => ({ ts: s.ts.getTime(), equity: s.equity })),
      latest?.ts.getTime() ?? 0,
    ),
    drawdown: downsample(
      dd.series.map((p) => ({ ts: p.ts.getTime(), dd: p.dd })),
      latest?.ts.getTime() ?? 0,
    ),
    performance,
    recentTrades: trades.slice(-5).reverse().map(serializeTrade),
    positions,
    streak,
    bigWin: bigWin ? serializeTrade(bigWin) : null,
  };
}

export async function getPositions(filter: ClassFilter) {
  "use cache";
  botCache();
  const { asOf, positions } = await loadPositions();
  return { asOf, positions: positions.filter((p) => matches(filter, p.assetClass)) };
}

export async function getTrades(filter: ClassFilter) {
  "use cache";
  botCache();
  const d = db();
  const where: SQL | undefined = filter === "all" ? undefined : eq(schema.orders.assetClass, filter);
  const [loaded, orderRows] = await Promise.all([
    loadTrades(),
    d.select().from(schema.orders).where(where).orderBy(desc(schema.orders.submittedAt)).limit(200),
  ]);
  const trades = loaded.trades.filter((t) => matches(filter, t.assetClass));
  const fees = loaded.fees.filter((f) => matches(filter, f.assetClass));

  const bySymbol = new Map<string, { symbol: string; pnl: number; count: number }>();
  for (const t of trades) {
    const s = bySymbol.get(t.symbol) ?? { symbol: t.symbol, pnl: 0, count: 0 };
    s.pnl += t.pnl;
    s.count++;
    bySymbol.set(t.symbol, s);
  }
  return {
    stats: tradeStats(trades),
    fees: fees.reduce((a, f) => a + f.amount, 0),
    trades: trades.slice().reverse().map(serializeTrade),
    bySymbol: [...bySymbol.values()].sort((a, b) => b.pnl - a.pnl),
    orders: orderRows.map((o) => ({
      id: o.id,
      clientOrderId: o.clientOrderId,
      isLeg: o.parentId !== null,
      symbol: o.symbol,
      assetClass: o.assetClass as AssetClass,
      side: o.side,
      qty: o.qty,
      filledQty: o.filledQty,
      type: o.type,
      orderClass: o.orderClass,
      status: o.status,
      strategy: o.strategy,
      submittedAt: o.submittedAt.getTime(),
      filledAt: ms(o.filledAt),
      filledAvgPrice: o.filledAvgPrice,
      stopPrice: o.stopPrice,
    })),
  };
}

export async function getStrategies(filter: ClassFilter) {
  "use cache";
  botCache();
  const d = db();
  const since = new Date(Date.now() - 14 * 86_400_000);
  const classWhere = filter === "all" ? undefined : eq(schema.signals.assetClass, filter);
  const [{ trades }, { positions }, recentSignals, latestSignals, live] = await Promise.all([
    loadTrades(),
    loadPositions(),
    d
      .select()
      .from(schema.signals)
      .where(and(ne(schema.signals.action, "hold"), classWhere))
      .orderBy(desc(schema.signals.id))
      .limit(100),
    // Latest evaluation per symbol: stock signals stop when the market closes, crypto keeps going.
    d
      .selectDistinctOn([schema.signals.symbol])
      .from(schema.signals)
      .where(and(gte(schema.signals.ts, since), classWhere))
      .orderBy(schema.signals.symbol, desc(schema.signals.id)),
    getLiveParams(),
  ]);

  const serializeSignal = (s: typeof schema.signals.$inferSelect) => ({
    id: s.id,
    ts: s.ts.getTime(),
    barTs: s.barTs.getTime(),
    symbol: s.symbol,
    assetClass: s.assetClass as AssetClass,
    strategy: s.strategy,
    action: s.action,
    reason: s.reason,
    indicators: s.indicators,
    acted: s.acted,
    note: s.note,
  });

  // Names/descriptions reflect the live tuning, not just the code defaults.
  const strategies = Object.values(buildUnits(live)).map((st) => {
    const mine = trades.filter((t) => t.strategy === st.id && matches(filter, t.assetClass));
    const open = positions.filter((p) => p.strategy === st.id && matches(filter, p.assetClass));
    return {
      id: st.id,
      name: st.name,
      description: st.description,
      symbols: Object.entries(UNIVERSE)
        .filter(([sym, id]) => id === st.id && matches(filter, assetClassOf(sym)))
        .map(([s]) => s),
      stats: tradeStats(mine),
      unrealizedPl: open.reduce((a, p) => a + p.unrealizedPl, 0),
      openPositions: open.length,
    };
  });

  return {
    live,
    strategies,
    latest: latestSignals
      .map(serializeSignal)
      .sort((a, b) => a.assetClass.localeCompare(b.assetClass) || a.symbol.localeCompare(b.symbol)),
    recent: recentSignals.map(serializeSignal),
  };
}

export async function getRuns(page = 1, size = 5) {
  "use cache";
  botCache();
  const d = db();
  const [rows, [{ total }]] = await Promise.all([
    d
      .select()
      .from(schema.botRuns)
      .orderBy(desc(schema.botRuns.id))
      .limit(size)
      .offset((page - 1) * size),
    d.select({ total: count() }).from(schema.botRuns),
  ]);
  const runs = rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.getTime(),
    status: r.status,
    marketOpen: r.marketOpen,
    signals: r.signals,
    ordersPlaced: r.ordersPlaced,
    durationMs: r.durationMs,
    message: r.message,
    error: r.error,
    trigger: r.trigger,
  }));
  return { runs, total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
}

export type ClockState = { isOpen: boolean; nextOpen: string; nextClose: string; asOf: string };

/** Header strip: ticker quotes, market clock and last run — all written by the tick, never fetched live. */
export async function getMarketStrip() {
  "use cache";
  botCache();
  const d = db();
  const [settingsRows, [lastRun], [latestFill]] = await Promise.all([
    d.select().from(schema.settings),
    d
      .select({ startedAt: schema.botRuns.startedAt, status: schema.botRuns.status })
      .from(schema.botRuns)
      .orderBy(desc(schema.botRuns.id))
      .limit(1),
    d.select({ id: schema.fills.id }).from(schema.fills).orderBy(desc(schema.fills.ts)).limit(1),
  ]);
  const get = <T>(key: string) => settingsRows.find((r) => r.key === key)?.value as T | undefined;
  const quotes = get<Record<string, Quote>>("quotes") ?? {};
  return {
    // Universe order: stocks first, then crypto.
    quotes: Object.keys(UNIVERSE)
      .map((s) => quotes[s])
      .filter((q): q is Quote => !!q),
    clock: get<ClockState>("clock") ?? null,
    paused: get<boolean>("paused") === true,
    latestFillId: latestFill?.id ?? null,
    lastRun: lastRun ? { startedAt: lastRun.startedAt.getTime(), status: lastRun.status } : null,
  };
}

export type SimulationRow = {
  id: number;
  createdAt: number;
  params: import("./simulator").SimParams;
  summary: import("./backtest").BacktestResult["summary"];
  bars: number;
  durationMs: number;
};

/** Saved simulator runs (newest first) and the full result of the selected one. */
export async function getSimulations(selectedId: number | null) {
  "use cache";
  botCache();
  const d = db();
  const rows = await d
    .select({
      id: schema.simulations.id,
      createdAt: schema.simulations.createdAt,
      params: schema.simulations.params,
      summary: schema.simulations.summary,
      bars: schema.simulations.bars,
      durationMs: schema.simulations.durationMs,
    })
    .from(schema.simulations)
    .orderBy(desc(schema.simulations.id))
    .limit(50);
  const id = selectedId ?? rows[0]?.id ?? null;
  const [selected] = id ? await d.select().from(schema.simulations).where(eq(schema.simulations.id, id)) : [];
  return {
    runs: rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }) as SimulationRow),
    selected: selected
      ? {
          ...(selected as unknown as SimulationRow),
          createdAt: selected.createdAt.getTime(),
          result: selected.result as Omit<import("./backtest").BacktestResult, "trades"> & {
            trades: (Omit<import("./backtest").SimTrade, "entryTs" | "exitTs"> & { entryTs: string; exitTs: string })[];
          },
        }
      : null,
  };
}

/** Current unit tuning (Hangar / Simulator defaults). */
export async function getLiveSettings() {
  "use cache";
  botCache();
  return getLiveParams();
}

/** Price bars around a trade, for its debrief chart. Historical bars never change, so cache long. */
async function getTradeBars(symbol: string, fromMs: number, toMs: number) {
  "use cache";
  cacheLife("days");
  const alpaca = await import("./alpaca");
  const start = new Date(fromMs);
  const res =
    assetClassOf(symbol) === "crypto"
      ? await alpaca.getCryptoBars([symbol], "15Min", start)
      : await alpaca.getBars([symbol], "15Min", start, new Date(toMs));
  return (res[symbol] ?? []).filter((b) => Date.parse(b.t) <= toMs).map((b) => ({ ts: Date.parse(b.t), close: b.c, low: b.l }));
}

/** Everything about one closed trade: the round trip, the signals that caused it, its stop, and nearby bars. */
export async function getDebrief(entryOrderId: string, exitOrderId: string) {
  "use cache";
  botCache();
  const d = db();
  const { trades } = await loadTrades();
  const legs = trades.filter((t) => t.entryOrderId === entryOrderId && t.exitOrderId === exitOrderId);
  if (!legs.length) return null;
  const t = legs[0];
  const qty = legs.reduce((a, l) => a + l.qty, 0);
  const pnl = legs.reduce((a, l) => a + l.pnl, 0);
  const fees = legs.reduce((a, l) => a + l.fees, 0);
  const cost = legs.reduce((a, l) => a + l.entryPrice * l.qty, 0);

  const [linkedSignals, orderRows] = await Promise.all([
    d
      .select()
      .from(schema.signals)
      .where(
        and(
          eq(schema.signals.symbol, t.symbol),
          ne(schema.signals.action, "hold"),
          gte(schema.signals.ts, new Date(t.entryTs.getTime() - 3_600_000)),
        ),
      )
      .orderBy(asc(schema.signals.id))
      .limit(200),
    d
      .select()
      .from(schema.orders)
      .where(and(eq(schema.orders.symbol, t.symbol), gte(schema.orders.submittedAt, new Date(t.entryTs.getTime() - 3_600_000))))
      .orderBy(asc(schema.orders.submittedAt)),
  ]);
  const inWindow = (ms: number) => ms <= t.exitTs.getTime() + 3_600_000;
  const signals = linkedSignals.filter((s) => inWindow(s.ts.getTime()));
  const entryOrder = orderRows.find((o) => o.id === entryOrderId) ?? null;
  const exitOrder = orderRows.find((o) => o.id === exitOrderId) ?? null;
  const stopOrder =
    orderRows.find((o) => (o.type === "stop" || o.type === "stop_limit") && o.side === "sell" && inWindow(o.submittedAt.getTime())) ?? null;

  // Chart window: a day of context on each side, capped at ~60 days so huge holds stay light.
  const span = Math.min(t.exitTs.getTime() - t.entryTs.getTime(), 60 * 86_400_000);
  const from = t.entryTs.getTime() - Math.max(86_400_000, span * 0.25);
  const to = Math.min(Date.now(), t.exitTs.getTime() + Math.max(86_400_000, span * 0.25));
  const bars = await getTradeBars(t.symbol, from, to).catch(() => []);

  // Bot orders carry their strategy as the client-id prefix ("sma_cross.sell…"); anything else is manual.
  const botOrder = (cid: string) => cid.split(".")[0] in UNITS_BY_ID;
  const exitKind = exitOrder
    ? exitOrder.type === "stop" || exitOrder.type === "stop_limit" || exitOrder.clientOrderId.includes(".stopexit.")
      ? "stop"
      : botOrder(exitOrder.clientOrderId)
        ? "signal"
        : "manual"
    : "unknown";

  return {
    symbol: t.symbol,
    assetClass: t.assetClass,
    strategy: t.strategy,
    entryTs: t.entryTs.getTime(),
    exitTs: t.exitTs.getTime(),
    entryPrice: cost / qty,
    exitPrice: t.exitPrice,
    qty,
    pnl,
    fees,
    returnPct: cost > 0 ? pnl / cost : 0,
    holdMs: t.exitTs.getTime() - t.entryTs.getTime(),
    exitKind,
    stopPrice: stopOrder?.stopPrice ?? null,
    entryClientId: entryOrder?.clientOrderId ?? null,
    exitClientId: exitOrder?.clientOrderId ?? null,
    signals: signals.map((s) => ({
      ts: s.ts.getTime(),
      action: s.action,
      reason: s.reason,
      note: s.note,
      acted: s.acted,
      indicators: s.indicators,
    })),
    bars,
  };
}
