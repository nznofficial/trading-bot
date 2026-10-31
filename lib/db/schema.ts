import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** "us_equity" | "crypto" — rows from before crypto support are stocks. */
const assetClass = () => text("asset_class").notNull().default("us_equity");

export const botRuns = pgTable("bot_runs", {
  id: serial("id").primaryKey(),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
  /** running | ok | closed | paused | skipped | error */
  status: text("status").notNull().default("running"),
  marketOpen: boolean("market_open"),
  signals: integer("signals").notNull().default(0),
  ordersPlaced: integer("orders_placed").notNull().default(0),
  durationMs: integer("duration_ms"),
  message: text("message"),
  error: text("error"),
  /** What started the run: cron-job.org, github, admin, manual, … */
  trigger: text("trigger"),
});

export const equitySnapshots = pgTable(
  "equity_snapshots",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull(),
    ts: ts("ts").notNull().defaultNow(),
    equity: doublePrecision("equity").notNull(),
    lastEquity: doublePrecision("last_equity").notNull(),
    cash: doublePrecision("cash").notNull(),
    buyingPower: doublePrecision("buying_power").notNull(),
    longMarketValue: doublePrecision("long_market_value").notNull(),
    marketOpen: boolean("market_open").notNull(),
  },
  (t) => [index("equity_snapshots_ts_idx").on(t.ts)],
);

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    clientOrderId: text("client_order_id").notNull(),
    parentId: text("parent_id"),
    symbol: text("symbol").notNull(),
    assetClass: assetClass(),
    side: text("side").notNull(),
    qty: doublePrecision("qty"),
    filledQty: doublePrecision("filled_qty").notNull().default(0),
    type: text("type").notNull(),
    orderClass: text("order_class"),
    status: text("status").notNull(),
    strategy: text("strategy"),
    submittedAt: ts("submitted_at").notNull(),
    filledAt: ts("filled_at"),
    filledAvgPrice: doublePrecision("filled_avg_price"),
    stopPrice: doublePrecision("stop_price"),
    limitPrice: doublePrecision("limit_price"),
  },
  (t) => [index("orders_submitted_idx").on(t.submittedAt)],
);

export const fills = pgTable(
  "fills",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    symbol: text("symbol").notNull(),
    assetClass: assetClass(),
    side: text("side").notNull(),
    qty: doublePrecision("qty").notNull(),
    price: doublePrecision("price").notNull(),
    ts: ts("ts").notNull(),
  },
  (t) => [index("fills_ts_idx").on(t.ts)],
);

export const positionsSnapshot = pgTable(
  "positions_snapshot",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull(),
    ts: ts("ts").notNull().defaultNow(),
    symbol: text("symbol").notNull(),
    assetClass: assetClass(),
    qty: doublePrecision("qty").notNull(),
    avgEntry: doublePrecision("avg_entry").notNull(),
    currentPrice: doublePrecision("current_price").notNull(),
    marketValue: doublePrecision("market_value").notNull(),
    unrealizedPl: doublePrecision("unrealized_pl").notNull(),
    unrealizedPlpc: doublePrecision("unrealized_plpc").notNull(),
  },
  (t) => [index("positions_snapshot_run_idx").on(t.runId)],
);

export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull(),
    ts: ts("ts").notNull().defaultNow(),
    barTs: ts("bar_ts").notNull(),
    symbol: text("symbol").notNull(),
    assetClass: assetClass(),
    strategy: text("strategy").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    indicators: jsonb("indicators").$type<Record<string, number | null>>().notNull(),
    acted: boolean("acted").notNull().default(false),
    /** Why an actionable signal was or wasn't executed (risk skip, order id, error). */
    note: text("note"),
  },
  (t) => [index("signals_ts_idx").on(t.ts)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

/** Daily closes for each benchmark (SPY for stocks, BTC/USD for crypto). */
export const benchmarkCloses = pgTable(
  "benchmark_closes",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    close: doublePrecision("close").notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/** Crypto trading fees (CFEE activities), valued in USD. */
export const fees = pgTable(
  "fees",
  {
    id: text("id").primaryKey(),
    symbol: text("symbol").notNull(),
    assetClass: assetClass(),
    orderId: text("order_id"),
    amountUsd: doublePrecision("amount_usd").notNull(),
    ts: ts("ts").notNull(),
    raw: jsonb("raw").notNull(),
  },
  (t) => [index("fees_ts_idx").on(t.ts)],
);

/** Saved simulator (backtest) runs. `result` holds the daily equity, per-unit/per-symbol stats and trades. */
export const simulations = pgTable(
  "simulations",
  {
    id: serial("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    params: jsonb("params").notNull(),
    summary: jsonb("summary").notNull(),
    result: jsonb("result").notNull(),
    bars: integer("bars").notNull(),
    durationMs: integer("duration_ms").notNull(),
  },
  (t) => [index("simulations_created_idx").on(t.createdAt)],
);

/**
 * Rate-limit counters for JC-316 chat: one row per bucket (visitor-minute, visitor-day, global-day).
 * Visitors are identified by a salted hash of their IP; messages themselves are never stored.
 */
export const chatCounters = pgTable(
  "chat_counters",
  {
    bucket: text("bucket").primaryKey(),
    count: integer("count").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("chat_counters_expires_idx").on(t.expiresAt)],
);

/** Headlines from Alpaca's news feed (Benzinga and partners) for every symbol the bot tracks. */
export const newsItems = pgTable(
  "news_items",
  {
    /** Alpaca's article id. */
    id: integer("id").primaryKey(),
    createdAt: ts("created_at").notNull(),
    headline: text("headline").notNull(),
    summary: text("summary").notNull().default(""),
    source: text("source").notNull(),
    url: text("url"),
    /** Every symbol the article is tagged with (not just ones the bot tracks). */
    symbols: text("symbols").array().notNull(),
  },
  (t) => [index("news_items_created_idx").on(t.createdAt)],
);

/**
 * Claude's read of one article for one tracked symbol: sentiment −1..1 for that symbol's stock,
 * materiality 0..1 (how much it should move the price). One row per (article, symbol) pair.
 */
export const newsScores = pgTable(
  "news_scores",
  {
    newsId: integer("news_id").notNull(),
    symbol: text("symbol").notNull(),
    /** Copied from the article so lookups by symbol and time need no join. */
    createdAt: ts("created_at").notNull(),
    sentiment: doublePrecision("sentiment").notNull(),
    materiality: doublePrecision("materiality").notNull(),
    category: text("category").notNull(),
    rationale: text("rationale").notNull(),
    model: text("model").notNull(),
    scoredAt: ts("scored_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.newsId, t.symbol] }), index("news_scores_symbol_created_idx").on(t.symbol, t.createdAt)],
);

/** Audit trail: every action the news layer took and the headline that caused it. */
export const newsActions = pgTable(
  "news_actions",
  {
    id: serial("id").primaryKey(),
    ts: ts("ts").notNull().defaultNow(),
    runId: integer("run_id"),
    newsId: integer("news_id").notNull(),
    symbol: text("symbol").notNull(),
    /** veto | tighten | herald_entry | herald_exit */
    kind: text("kind").notNull(),
    /** Unit that owns the symbol. */
    unit: text("unit"),
    detail: text("detail").notNull(),
    expiresAt: ts("expires_at"),
  },
  (t) => [index("news_actions_ts_idx").on(t.ts), uniqueIndex("news_actions_dedupe_idx").on(t.newsId, t.symbol, t.kind)],
);
