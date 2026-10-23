import { asc, desc, eq, gte, ne } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import {
  aggregateFills,
  dailyCloses,
  drawdowns,
  matchRoundTrips,
  pctReturns,
  sharpe,
  sortino,
  tradeStats,
  type RoundTrip,
} from "./analytics";
import { BENCHMARK, UNIVERSE } from "./config";
import { db, schema } from "./db";
import { STRATEGIES } from "./strategies";

/**
 * All dashboard reads are cached briefly and tagged "bot"; each tick revalidates the tag.
 * An expire under 5 minutes keeps these out of the build-time prerender, so the build never needs the DB.
 */
function botCache() {
  cacheTag("bot");
  cacheLife({ stale: 30, revalidate: 60, expire: 120 });
}

const ms = (d: Date | null) => (d ? d.getTime() : null);

export type SerializedTrade = Omit<RoundTrip, "entryTs" | "exitTs"> & { entryTs: number; exitTs: number };

async function loadTrades() {
  const d = db();
  const [fillRows, orderRows] = await Promise.all([
    d.select().from(schema.fills).orderBy(asc(schema.fills.ts)),
    d.select({ id: schema.orders.id, strategy: schema.orders.strategy }).from(schema.orders),
  ]);
  const strategyByOrder = new Map(orderRows.filter((o) => o.strategy).map((o) => [o.id, o.strategy!]));
  return matchRoundTrips(aggregateFills(fillRows, strategyByOrder));
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
  const [snaps, bench, [lastRun], [paused], { trades }, { positions }] = await Promise.all([
    d.select().from(schema.equitySnapshots).orderBy(asc(schema.equitySnapshots.ts)),
    d.select().from(schema.benchmarkBars).orderBy(asc(schema.benchmarkBars.date)),
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

  // Portfolio vs SPY, both as % return since the first trading day we have equity for.
  const benchByDate = new Map(bench.map((b) => [b.date, b.close]));
  const startDate = daily[0]?.date;
  const benchBase = startDate
    ? (bench.find((b) => b.date === startDate) ?? bench.findLast((b) => b.date < startDate))?.close
    : undefined;
  let lastBench = benchBase;
  const performance = daily.map((p) => {
    lastBench = benchByDate.get(p.date) ?? lastBench;
    return {
      date: p.date,
      portfolio: first ? p.equity / first.equity - 1 : 0,
      benchmark: benchBase && lastBench ? lastBench / benchBase - 1 : null,
    };
  });

  const unrealized = positions.reduce((a, p) => a + p.unrealizedPl, 0);
  const stats = tradeStats(trades);

  return {
    hasData: snaps.length > 0,
    paused: paused?.value === true,
    benchmark: BENCHMARK,
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
          tradingDays: daily.length,
          realizedPnl: stats.totalPnl,
          unrealizedPnl: unrealized,
          openPositions: positions.length,
          since: first.ts.getTime(),
        }
      : null,
    stats,
    equity: snaps.map((s) => ({ ts: s.ts.getTime(), equity: s.equity })),
    drawdown: dd.series.map((p) => ({ ts: p.ts.getTime(), dd: p.dd })),
    performance,
    recentTrades: trades.slice(-5).reverse().map(serializeTrade),
  };
}

export async function getPositions() {
  "use cache";
  botCache();
  return loadPositions();
}

export async function getTrades() {
  "use cache";
  botCache();
  const d = db();
  const [{ trades, openLots }, orderRows] = await Promise.all([
    loadTrades(),
    d.select().from(schema.orders).orderBy(desc(schema.orders.submittedAt)).limit(200),
  ]);
  const bySymbol = new Map<string, { symbol: string; pnl: number; count: number }>();
  for (const t of trades) {
    const s = bySymbol.get(t.symbol) ?? { symbol: t.symbol, pnl: 0, count: 0 };
    s.pnl += t.pnl;
    s.count++;
    bySymbol.set(t.symbol, s);
  }
  return {
    stats: tradeStats(trades),
    trades: trades.slice().reverse().map(serializeTrade),
    openLots: openLots.map((l) => ({ ...l, ts: l.ts.getTime() })),
    bySymbol: [...bySymbol.values()].sort((a, b) => b.pnl - a.pnl),
    orders: orderRows.map((o) => ({
      id: o.id,
      clientOrderId: o.clientOrderId,
      isLeg: o.parentId !== null,
      symbol: o.symbol,
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

export async function getStrategies() {
  "use cache";
  botCache();
  const d = db();
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [{ trades }, { positions }, recentSignals, [latestRun]] = await Promise.all([
    loadTrades(),
    loadPositions(),
    d
      .select()
      .from(schema.signals)
      .where(ne(schema.signals.action, "hold"))
      .orderBy(desc(schema.signals.id))
      .limit(100),
    d
      .select({ runId: schema.signals.runId })
      .from(schema.signals)
      .where(gte(schema.signals.ts, since))
      .orderBy(desc(schema.signals.id))
      .limit(1),
  ]);
  const latestSignals = latestRun
    ? await d.select().from(schema.signals).where(eq(schema.signals.runId, latestRun.runId))
    : [];

  const serializeSignal = (s: typeof schema.signals.$inferSelect) => ({
    id: s.id,
    ts: s.ts.getTime(),
    barTs: s.barTs.getTime(),
    symbol: s.symbol,
    strategy: s.strategy,
    action: s.action,
    reason: s.reason,
    indicators: s.indicators,
    acted: s.acted,
    note: s.note,
  });

  const strategies = Object.values(STRATEGIES).map((st) => {
    const mine = trades.filter((t) => t.strategy === st.id);
    const open = positions.filter((p) => p.strategy === st.id);
    return {
      id: st.id,
      name: st.name,
      description: st.description,
      symbols: Object.entries(UNIVERSE)
        .filter(([, id]) => id === st.id)
        .map(([s]) => s),
      stats: tradeStats(mine),
      unrealizedPl: open.reduce((a, p) => a + p.unrealizedPl, 0),
      openPositions: open.length,
    };
  });

  return {
    strategies,
    latest: latestSignals.map(serializeSignal).sort((a, b) => a.symbol.localeCompare(b.symbol)),
    recent: recentSignals.map(serializeSignal),
  };
}

export async function getRuns() {
  "use cache";
  botCache();
  const rows = await db().select().from(schema.botRuns).orderBy(desc(schema.botRuns.id)).limit(150);
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.startedAt.getTime(),
    status: r.status,
    marketOpen: r.marketOpen,
    signals: r.signals,
    ordersPlaced: r.ordersPlaced,
    durationMs: r.durationMs,
    message: r.message,
    error: r.error,
  }));
}
