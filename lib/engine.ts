import { and, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import * as alpaca from "./alpaca";
import { tradingDay } from "./analytics";
import { BAR_LOOKBACK_DAYS, BAR_MINUTES, BAR_TIMEFRAME, BENCHMARK, SYMBOLS } from "./config";
import { db, schema } from "./db";
import { dateTime } from "./format";
import { createRiskGate } from "./risk";
import { STRATEGIES, strategyFor, type Signal } from "./strategies";

export type TickOptions = {
  /** Evaluate strategies even if the market is closed, but never submit or cancel orders. */
  dryRun?: boolean;
};

export type TickResult = {
  runId: number;
  status: "ok" | "closed" | "paused" | "skipped" | "error";
  marketOpen: boolean | null;
  signals: number;
  ordersPlaced: number;
  message?: string;
  error?: string;
  decisions?: { symbol: string; strategy: string; action: string; reason: string; note: string | null }[];
};

const num = (s: string | null | undefined) => (s == null ? null : Number(s));

/** Client order ids encode the strategy so every fill can be attributed: `{strategy}.{side}.{symbol}.{barTime}` */
export function makeClientOrderId(strategy: string, side: string, symbol: string, barTs: string) {
  return `${strategy}.${side}.${symbol}.${barTs.replace(/[^0-9]/g, "").slice(0, 12)}`;
}

export function strategyFromClientOrderId(id: string): string | null {
  const prefix = id.split(".")[0];
  return prefix in STRATEGIES ? prefix : null;
}

const nyTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** True for bars that start within the 09:30–16:00 ET regular session. */
export function isRegularSessionBar(t: string) {
  const [h, m] = nyTime.format(new Date(t)).split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db()
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}

export async function runTick(opts: TickOptions = {}): Promise<TickResult> {
  const started = Date.now();
  const d = db();
  const [run] = await d.insert(schema.botRuns).values({}).returning({ id: schema.botRuns.id });

  const finish = async (r: Omit<TickResult, "runId">): Promise<TickResult> => {
    await d
      .update(schema.botRuns)
      .set({
        status: r.status,
        finishedAt: new Date(),
        marketOpen: r.marketOpen,
        signals: r.signals,
        ordersPlaced: r.ordersPlaced,
        durationMs: Date.now() - started,
        message: r.message ?? null,
        error: r.error ?? null,
      })
      .where(eq(schema.botRuns.id, run.id));
    return { runId: run.id, ...r };
  };

  try {
    // Guard against overlapping ticks (e.g. a manual trigger racing the cron).
    const [concurrent] = await d
      .select({ id: schema.botRuns.id })
      .from(schema.botRuns)
      .where(
        and(
          eq(schema.botRuns.status, "running"),
          lt(schema.botRuns.id, run.id),
          gte(schema.botRuns.startedAt, new Date(Date.now() - 5 * 60_000)),
        ),
      )
      .limit(1);
    if (concurrent) {
      return finish({ status: "skipped", marketOpen: null, signals: 0, ordersPlaced: 0, message: `run ${concurrent.id} in progress` });
    }

    const [clock, account, paused] = await Promise.all([
      alpaca.getClock(),
      alpaca.getAccount(),
      getSetting("paused", false),
    ]);
    if (account.trading_blocked || account.account_blocked) throw new Error(`account blocked (${account.status})`);

    const [positions, openOrders] = await Promise.all([
      alpaca.getPositions(),
      alpaca.getOrders({ status: "open", nested: false }),
      syncFills(),
      syncOrders(),
      syncBenchmark().catch((e) => console.warn("benchmark sync failed", e)),
    ]);

    await snapshot(run.id, account, positions, clock.is_open);

    if (paused) return finish({ status: "paused", marketOpen: clock.is_open, signals: 0, ordersPlaced: 0, message: "bot is paused" });
    if (!clock.is_open && !opts.dryRun) {
      return finish({ status: "closed", marketOpen: false, signals: 0, ordersPlaced: 0, message: `next open ${dateTime(Date.parse(clock.next_open))}` });
    }

    // --- Market data -------------------------------------------------------------------------
    const now = new Date(clock.timestamp);
    const start = new Date(now.getTime() - BAR_LOOKBACK_DAYS * 86_400_000);
    const allBars = await alpaca.getBars(SYMBOLS, BAR_TIMEFRAME, start);
    const barMs = BAR_MINUTES * 60_000;

    // --- Signals + execution -----------------------------------------------------------------
    const held = new Map(positions.map((p) => [p.symbol, Number(p.qty)]));
    const gate = createRiskGate({
      equity: Number(account.equity),
      lastEquity: Number(account.last_equity),
      buyingPower: Number(account.buying_power),
      heldSymbols: new Set(held.keys()),
      symbolsWithOpenOrders: new Set(openOrders.map((o) => o.symbol)),
    });

    const signalRows: (typeof schema.signals.$inferInsert)[] = [];
    const submitted: alpaca.Order[] = [];

    for (const symbol of SYMBOLS) {
      const strategy = strategyFor(symbol)!;
      // Only completed regular-session bars feed the indicators.
      const bars = (allBars[symbol] ?? []).filter(
        (b) => isRegularSessionBar(b.t) && new Date(b.t).getTime() + barMs <= now.getTime(),
      );
      const lastBar = bars[bars.length - 1];
      const qty = held.get(symbol) ?? 0;

      let signal: Signal;
      if (!lastBar || bars.length < strategy.minBars) {
        signal = { action: "hold", reason: `insufficient data (${bars.length}/${strategy.minBars} bars)`, indicators: {} };
      } else if (!opts.dryRun && now.getTime() - new Date(lastBar.t).getTime() > 3 * barMs) {
        signal = { action: "hold", reason: "stale data", indicators: {} };
      } else {
        signal = strategy.evaluate({ bars, positionQty: qty });
      }

      let acted = false;
      let note: string | null = null;
      const barTs = lastBar?.t ?? now.toISOString();

      if (signal.action === "buy") {
        const decision = gate.approveEntry(symbol, lastBar.c);
        if (!decision.ok) {
          note = `skipped: ${decision.reason}`;
        } else if (opts.dryRun) {
          note = `dry run: would buy ${decision.qty} @ ~${lastBar.c} stop ${decision.stopLoss}`;
        } else {
          try {
            const order = await alpaca.submitOrder({
              symbol,
              qty: decision.qty,
              side: "buy",
              client_order_id: makeClientOrderId(strategy.id, "buy", symbol, barTs),
              stop_loss: decision.stopLoss,
              take_profit: decision.takeProfit,
            });
            submitted.push(order);
            acted = true;
            note = `buy ${decision.qty} (stop ${decision.stopLoss}) order ${order.id}`;
          } catch (e) {
            note = duplicateOrder(e) ? "already submitted for this bar" : `order error: ${errMsg(e)}`;
          }
        }
      } else if (signal.action === "sell" && qty > 0) {
        if (opts.dryRun) {
          note = `dry run: would sell ${qty}`;
        } else {
          try {
            // The protective stop leg holds the shares; cancel it before selling.
            await cancelOpenOrdersFor(symbol, openOrders);
            const order = await alpaca.submitOrder({
              symbol,
              qty,
              side: "sell",
              client_order_id: makeClientOrderId(strategy.id, "sell", symbol, barTs),
            });
            submitted.push(order);
            acted = true;
            note = `sell ${qty} order ${order.id}`;
          } catch (e) {
            note = duplicateOrder(e) ? "already submitted for this bar" : `order error: ${errMsg(e)}`;
          }
        }
      }

      signalRows.push({
        runId: run.id,
        barTs: new Date(barTs),
        symbol,
        strategy: strategy.id,
        action: signal.action,
        reason: signal.reason,
        indicators: signal.indicators,
        acted,
        note,
      });
    }

    if (signalRows.length) await d.insert(schema.signals).values(signalRows);
    if (submitted.length) await upsertOrders(submitted);

    const result: Omit<TickResult, "runId"> = {
      status: "ok",
      marketOpen: clock.is_open,
      signals: signalRows.filter((s) => s.action !== "hold").length,
      ordersPlaced: submitted.length,
      message: [
        opts.dryRun ? "dry run" : null,
        `day P&L ${(gate.dailyPnlPct * 100).toFixed(2)}%`,
      ]
        .filter(Boolean)
        .join(" · "),
      decisions: signalRows.map((s) => ({
        symbol: s.symbol,
        strategy: s.strategy,
        action: s.action,
        reason: s.reason,
        note: s.note ?? null,
      })),
    };
    return finish(result);
  } catch (e) {
    console.error("tick failed", e);
    return finish({ status: "error", marketOpen: null, signals: 0, ordersPlaced: 0, error: errMsg(e) });
  }
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const duplicateOrder = (e: unknown) =>
  e instanceof alpaca.AlpacaError && e.status === 422 && /client_order_id/i.test(e.body);

async function cancelOpenOrdersFor(symbol: string, openOrders: alpaca.Order[]) {
  const mine = openOrders.filter((o) => o.symbol === symbol);
  await Promise.all(mine.map((o) => alpaca.cancelOrder(o.id)));
  // Cancellation is asynchronous; wait until the shares are released.
  for (const o of mine) {
    for (let i = 0; i < 15; i++) {
      const cur = await alpaca.getOrder(o.id);
      if (["canceled", "filled", "expired", "rejected"].includes(cur.status)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

async function snapshot(runId: number, account: alpaca.Account, positions: alpaca.Position[], marketOpen: boolean) {
  const d = db();
  await d.insert(schema.equitySnapshots).values({
    runId,
    equity: Number(account.equity),
    lastEquity: Number(account.last_equity),
    cash: Number(account.cash),
    buyingPower: Number(account.buying_power),
    longMarketValue: Number(account.long_market_value),
    marketOpen,
  });
  if (positions.length) {
    await d.insert(schema.positionsSnapshot).values(
      positions.map((p) => ({
        runId,
        symbol: p.symbol,
        qty: Number(p.qty),
        avgEntry: Number(p.avg_entry_price),
        currentPrice: Number(p.current_price),
        marketValue: Number(p.market_value),
        unrealizedPl: Number(p.unrealized_pl),
        unrealizedPlpc: Number(p.unrealized_plpc),
      })),
    );
  }
}

/** Pull new FILL activities into the local ledger (idempotent). */
async function syncFills() {
  const d = db();
  const [{ latest }] = await d.select({ latest: max(schema.fills.ts) }).from(schema.fills);
  const after = latest ? new Date(latest.getTime() - 60_000).toISOString() : undefined;
  const activities = await alpaca.getFills(after);
  if (!activities.length) return;
  await d
    .insert(schema.fills)
    .values(
      activities.map((a) => ({
        id: a.id,
        orderId: a.order_id,
        symbol: a.symbol,
        side: a.side,
        qty: Number(a.qty),
        price: Number(a.price),
        ts: new Date(a.transaction_time),
      })),
    )
    .onConflictDoNothing();
}

/** Refresh status of the last week's orders, including bracket/OTO legs. */
async function syncOrders() {
  const after = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recent = await alpaca.getOrders({ status: "all", after, nested: true });
  await upsertOrders(recent);
}

async function upsertOrders(list: alpaca.Order[]) {
  const rows: (typeof schema.orders.$inferInsert)[] = [];
  const add = (o: alpaca.Order, parent?: alpaca.Order) => {
    rows.push({
      id: o.id,
      clientOrderId: o.client_order_id,
      parentId: parent?.id ?? null,
      symbol: o.symbol,
      side: o.side,
      qty: num(o.qty),
      filledQty: Number(o.filled_qty),
      type: o.type,
      orderClass: o.order_class || null,
      status: o.status,
      strategy: strategyFromClientOrderId((parent ?? o).client_order_id),
      submittedAt: new Date(o.submitted_at),
      filledAt: o.filled_at ? new Date(o.filled_at) : null,
      filledAvgPrice: num(o.filled_avg_price),
      stopPrice: num(o.stop_price),
      limitPrice: num(o.limit_price),
    });
    for (const leg of o.legs ?? []) add(leg, o);
  };
  list.forEach((o) => add(o));
  if (!rows.length) return;
  await db()
    .insert(schema.orders)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.orders.id,
      set: {
        status: sql`excluded.status`,
        filledQty: sql`excluded.filled_qty`,
        filledAt: sql`excluded.filled_at`,
        filledAvgPrice: sql`excluded.filled_avg_price`,
        parentId: sql`coalesce(${schema.orders.parentId}, excluded.parent_id)`,
        strategy: sql`coalesce(${schema.orders.strategy}, excluded.strategy)`,
      },
    });
}

/** Cache benchmark daily closes so the dashboard never calls Alpaca at render time. */
async function syncBenchmark() {
  const d = db();
  const [latest] = await d
    .select({ date: schema.benchmarkBars.date })
    .from(schema.benchmarkBars)
    .orderBy(desc(schema.benchmarkBars.date))
    .limit(1);
  const [first] = await d
    .select({ ts: schema.equitySnapshots.ts })
    .from(schema.equitySnapshots)
    .orderBy(schema.equitySnapshots.ts)
    .limit(1);
  const fallbackStart = first?.ts ?? new Date();
  // Re-fetch from the latest cached day (its close may have been partial) or a week before inception.
  const start = latest
    ? new Date(`${latest.date}T00:00:00Z`)
    : new Date(fallbackStart.getTime() - 7 * 86_400_000);
  const bars = (await alpaca.getBars([BENCHMARK], "1Day", start))[BENCHMARK] ?? [];
  if (!bars.length) return;
  await d
    .insert(schema.benchmarkBars)
    .values(bars.map((b) => ({ date: tradingDay(new Date(b.t)), close: b.c })))
    .onConflictDoUpdate({ target: schema.benchmarkBars.date, set: { close: sql`excluded.close` } });
}
