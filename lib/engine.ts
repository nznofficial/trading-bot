import { and, desc, eq, gte, lt, max, sql } from "drizzle-orm";
import * as alpaca from "./alpaca";
import { tradingDay } from "./analytics";
import {
  assetClassOf,
  BAR_LOOKBACK_DAYS,
  BAR_MINUTES,
  BAR_TIMEFRAME,
  BENCHMARKS,
  CRYPTO_BAR_LOOKBACK_DAYS,
  CRYPTO_SYMBOLS,
  normalizeSymbol,
  STOCK_SYMBOLS,
  type AssetClass,
} from "./config";
import { db, schema } from "./db";
import { dateTime } from "./format";
import { createRiskGate, planCryptoStop } from "./risk";
import { STRATEGIES, strategyFor, type Signal } from "./strategies";

export type TickOptions = {
  /** Evaluate strategies even if the market is closed, but never submit or cancel orders. */
  dryRun?: boolean;
};

export type Decision = {
  symbol: string;
  assetClass: AssetClass;
  strategy: string;
  action: string;
  reason: string;
  note: string | null;
};

export type TickResult = {
  runId: number;
  status: "ok" | "closed" | "paused" | "skipped" | "error";
  marketOpen: boolean | null;
  signals: number;
  ordersPlaced: number;
  message?: string;
  error?: string;
  decisions?: Decision[];
};

const num = (s: string | null | undefined) => (s == null ? null : Number(s));

/**
 * Client order ids encode the strategy so every fill can be attributed:
 * `{strategy}.{side}.{symbol}.{barTime}`. Crypto symbols drop the slash ("BTCUSD").
 */
export function makeClientOrderId(strategy: string, side: string, symbol: string, barTs: string) {
  return `${strategy}.${side}.${symbol.replace("/", "")}.${barTs.replace(/[^0-9]/g, "").slice(0, 12)}`;
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

/** Positions and orders with crypto symbols normalized to "BTC/USD". */
const normalizePosition = (p: alpaca.Position): alpaca.Position => ({ ...p, symbol: normalizeSymbol(p.symbol, p.asset_class) });
const normalizeOrder = (o: alpaca.Order): alpaca.Order => ({
  ...o,
  symbol: normalizeSymbol(o.symbol, o.asset_class),
  legs: o.legs?.map(normalizeOrder) ?? null,
});

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

    const [rawPositions, rawOpenOrders] = await Promise.all([
      alpaca.getPositions(),
      alpaca.getOrders({ status: "open", nested: false }),
      syncFills(),
      syncFees().catch((e) => console.warn("fee sync failed", e)),
      syncOrders(),
      syncBenchmarks().catch((e) => console.warn("benchmark sync failed", e)),
    ]);
    const positions = rawPositions.map(normalizePosition);
    const openOrders = rawOpenOrders.map(normalizeOrder);

    await snapshot(run.id, account, positions, clock.is_open);

    if (paused) return finish({ status: "paused", marketOpen: clock.is_open, signals: 0, ordersPlaced: 0, message: "bot is paused" });

    // Stocks only trade in the regular session; crypto trades every tick.
    const stocksActive = clock.is_open || !!opts.dryRun;
    const symbols = [...(stocksActive ? STOCK_SYMBOLS : []), ...CRYPTO_SYMBOLS];
    if (!symbols.length) {
      return finish({ status: "closed", marketOpen: false, signals: 0, ordersPlaced: 0, message: `next open ${dateTime(Date.parse(clock.next_open))}` });
    }

    // --- Market data -------------------------------------------------------------------------
    const now = new Date(clock.timestamp);
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const [stockBars, cryptoBars] = await Promise.all([
      stocksActive ? alpaca.getBars(STOCK_SYMBOLS, BAR_TIMEFRAME, daysAgo(BAR_LOOKBACK_DAYS)) : {},
      CRYPTO_SYMBOLS.length ? alpaca.getCryptoBars(CRYPTO_SYMBOLS, BAR_TIMEFRAME, daysAgo(CRYPTO_BAR_LOOKBACK_DAYS)) : {},
    ]);
    const allBars: Record<string, alpaca.Bar[]> = { ...stockBars, ...cryptoBars };
    const barMs = BAR_MINUTES * 60_000;

    // --- Signals + execution -----------------------------------------------------------------
    const held = new Map(positions.map((p) => [p.symbol, Number(p.qty)]));
    const gate = createRiskGate({
      equity: Number(account.equity),
      lastEquity: Number(account.last_equity),
      buyingPower: Number(account.buying_power),
      nonMarginableBuyingPower: Number(account.non_marginable_buying_power),
      cryptoExposure: positions
        .filter((p) => assetClassOf(p.symbol) === "crypto")
        .reduce((a, p) => a + Number(p.market_value), 0),
      heldSymbols: new Set(held.keys()),
      symbolsWithOpenOrders: new Set(openOrders.map((o) => o.symbol)),
    });

    const signalRows: (typeof schema.signals.$inferInsert)[] = [];
    const submitted: alpaca.Order[] = [];
    /** Symbols whose orders this tick already handled; the stop check skips them. */
    const touched = new Set<string>();

    for (const symbol of symbols) {
      const strategy = strategyFor(symbol)!;
      const cls = assetClassOf(symbol);
      // Completed bars only; stocks also drop pre/post-market bars.
      const bars = (allBars[symbol] ?? []).filter(
        (b) => (cls === "crypto" || isRegularSessionBar(b.t)) && new Date(b.t).getTime() + barMs <= now.getTime(),
      );
      const lastBar = bars[bars.length - 1];
      const qty = held.get(symbol) ?? 0;

      let signal: Signal;
      if (!lastBar || bars.length < strategy.minBars) {
        signal = { action: "hold", reason: `insufficient data (${bars.length}/${strategy.minBars} bars)`, indicators: {} };
      } else if ((!opts.dryRun || cls === "crypto") && now.getTime() - new Date(lastBar.t).getTime() > 3 * barMs) {
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
          note = `dry run: would buy ${alpaca.formatQty(decision.qty)} @ ~${lastBar.c} stop ${decision.stopLoss}`;
        } else {
          try {
            const clientOrderId = makeClientOrderId(strategy.id, "buy", symbol, barTs);
            if (cls === "crypto") {
              const order = await alpaca.submitOrder({
                symbol,
                qty: decision.qty,
                side: "buy",
                time_in_force: "gtc",
                client_order_id: clientOrderId,
              });
              submitted.push(order);
              touched.add(symbol);
              const stop = await protectCryptoEntry(order, strategy.id, barTs, decision.stopLoss, decision.stopLimit!);
              if (stop) submitted.push(stop);
              note = `buy ${alpaca.formatQty(decision.qty)} order ${order.id} · ${stop ? `stop ${decision.stopLoss}` : "stop next tick"}`;
            } else {
              const order = await alpaca.submitOrder({
                symbol,
                qty: decision.qty,
                side: "buy",
                client_order_id: clientOrderId,
                stop_loss: decision.stopLoss,
                take_profit: decision.takeProfit,
              });
              submitted.push(order);
              note = `buy ${decision.qty} (stop ${decision.stopLoss}) order ${order.id}`;
            }
            acted = true;
          } catch (e) {
            note = duplicateOrder(e) ? "already submitted for this bar" : `order error: ${errMsg(e)}`;
          }
        }
      } else if (signal.action === "sell" && qty > 0) {
        if (opts.dryRun) {
          note = `dry run: would sell ${alpaca.formatQty(qty)}`;
        } else {
          try {
            touched.add(symbol);
            // The protective stop holds the shares/coins; cancel it before selling.
            await cancelOpenOrdersFor(symbol, openOrders);
            const order = await alpaca.submitOrder({
              symbol,
              qty,
              side: "sell",
              time_in_force: cls === "crypto" ? "gtc" : "day",
              client_order_id: makeClientOrderId(strategy.id, "sell", symbol, barTs),
            });
            submitted.push(order);
            acted = true;
            note = `sell ${alpaca.formatQty(qty)} order ${order.id}`;
          } catch (e) {
            note = duplicateOrder(e) ? "already submitted for this bar" : `order error: ${errMsg(e)}`;
          }
        }
      }

      signalRows.push({
        runId: run.id,
        barTs: new Date(barTs),
        symbol,
        assetClass: cls,
        strategy: strategy.id,
        action: signal.action,
        reason: signal.reason,
        indicators: signal.indicators,
        acted,
        note,
      });
    }

    const stopNotes = opts.dryRun ? [] : await maintainCryptoStops(positions, openOrders, touched, submitted, now);

    if (signalRows.length) await d.insert(schema.signals).values(signalRows);
    if (submitted.length) await upsertOrders(submitted);

    const result: Omit<TickResult, "runId"> = {
      status: "ok",
      marketOpen: clock.is_open,
      signals: signalRows.filter((s) => s.action !== "hold").length,
      ordersPlaced: submitted.length,
      message: [
        opts.dryRun ? "dry run" : null,
        stocksActive ? null : "stocks closed",
        `day P&L ${(gate.dailyPnlPct * 100).toFixed(2)}%`,
        ...stopNotes,
      ]
        .filter(Boolean)
        .join(" · "),
      decisions: signalRows.map((s) => ({
        symbol: s.symbol,
        assetClass: s.assetClass as AssetClass,
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Crypto market orders usually fill within a second; wait briefly and attach the stop right away.
 * Returns null if it hasn't filled yet — the next tick's stop check will cover it.
 */
async function protectCryptoEntry(
  entry: alpaca.Order,
  strategy: string,
  barTs: string,
  stopPrice: number,
  limitPrice: number,
): Promise<alpaca.Order | null> {
  let order = entry;
  for (let i = 0; i < 10 && order.status !== "filled"; i++) {
    await sleep(400);
    order = normalizeOrder(await alpaca.getOrder(entry.id));
    if (["canceled", "expired", "rejected"].includes(order.status)) return null;
  }
  if (order.status !== "filled") return null;
  try {
    return await alpaca.submitOrder({
      symbol: order.symbol,
      qty: Number(order.filled_qty),
      side: "sell",
      type: "stop_limit",
      time_in_force: "gtc",
      stop_price: stopPrice,
      limit_price: limitPrice,
      client_order_id: makeClientOrderId(strategy, "stop", order.symbol, barTs),
    });
  } catch (e) {
    console.warn("stop placement failed", e);
    return null;
  }
}

/** Keep every crypto position covered by a resting stop-limit (see planCryptoStop). */
async function maintainCryptoStops(
  positions: alpaca.Position[],
  openOrders: alpaca.Order[],
  touched: Set<string>,
  submitted: alpaca.Order[],
  now: Date,
): Promise<string[]> {
  const notes: string[] = [];
  const stamp = now.toISOString();
  for (const p of positions) {
    if (assetClassOf(p.symbol) !== "crypto" || touched.has(p.symbol)) continue;
    const strategy = strategyFor(p.symbol)?.id ?? "manual";
    const plan = planCryptoStop(
      { qty: Number(p.qty), avgEntry: Number(p.avg_entry_price), currentPrice: Number(p.current_price) },
      openOrders
        .filter((o) => o.symbol === p.symbol && o.side === "sell")
        .map((o) => ({ id: o.id, type: o.type, qty: Number(o.qty ?? 0) - Number(o.filled_qty) })),
    );
    try {
      if (plan.action === "keep") continue;
      if (plan.action === "exit") {
        await cancelOpenOrdersFor(p.symbol, openOrders);
        submitted.push(
          await alpaca.submitOrder({
            symbol: p.symbol,
            qty: Number(p.qty),
            side: "sell",
            time_in_force: "gtc",
            client_order_id: makeClientOrderId(strategy, "stopexit", p.symbol, stamp),
          }),
        );
        notes.push(`${p.symbol} stop breached, exited`);
        continue;
      }
      if (plan.action === "replace") {
        await cancelOpenOrdersFor(p.symbol, openOrders.filter((o) => plan.cancelIds.includes(o.id)));
      }
      submitted.push(
        await alpaca.submitOrder({
          symbol: p.symbol,
          qty: Number(p.qty),
          side: "sell",
          type: "stop_limit",
          time_in_force: "gtc",
          stop_price: plan.stopPrice,
          limit_price: plan.limitPrice,
          client_order_id: makeClientOrderId(strategy, "stop", p.symbol, stamp),
        }),
      );
      notes.push(`${p.symbol} stop ${plan.action === "replace" ? "resized" : "placed"} @ ${plan.stopPrice}`);
    } catch (e) {
      notes.push(`${p.symbol} stop error: ${errMsg(e)}`);
    }
  }
  return notes;
}

async function cancelOpenOrdersFor(symbol: string, openOrders: alpaca.Order[]) {
  const mine = openOrders.filter((o) => o.symbol === symbol);
  await Promise.all(mine.map((o) => alpaca.cancelOrder(o.id)));
  // Cancellation is asynchronous; wait until the shares/coins are released.
  for (const o of mine) {
    for (let i = 0; i < 15; i++) {
      const cur = await alpaca.getOrder(o.id);
      if (["canceled", "filled", "expired", "rejected"].includes(cur.status)) break;
      await sleep(300);
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
        assetClass: assetClassOf(p.symbol),
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
      activities.map((a) => {
        const symbol = normalizeSymbol(a.symbol);
        return {
          id: a.id,
          orderId: a.order_id,
          symbol,
          assetClass: assetClassOf(symbol),
          side: a.side,
          qty: Number(a.qty),
          price: Number(a.price),
          ts: new Date(a.transaction_time),
        };
      }),
    )
    .onConflictDoNothing();
}

/** USD value of a crypto fee activity. Prefers net_amount; falls back to qty × price. */
export function feeUsd(a: Pick<alpaca.FeeActivity, "qty" | "price" | "net_amount">) {
  const net = Math.abs(Number(a.net_amount ?? 0));
  return net > 0 ? net : Math.abs(Number(a.qty ?? 0) * Number(a.price ?? 0));
}

/** Pull crypto fee activities (CFEE). Paper accounts may not generate any. */
async function syncFees() {
  const d = db();
  const [{ latest }] = await d.select({ latest: max(schema.fees.ts) }).from(schema.fees);
  const after = latest ? new Date(latest.getTime() - 86_400_000).toISOString() : undefined;
  const activities = await alpaca.getFees(after);
  if (!activities.length) return;
  await d
    .insert(schema.fees)
    .values(
      activities.map((a) => {
        const symbol = normalizeSymbol(a.symbol, "crypto");
        return {
          id: a.id,
          symbol,
          assetClass: assetClassOf(symbol),
          orderId: a.order_id ?? null,
          amountUsd: feeUsd(a),
          ts: new Date(a.transaction_time ?? a.date ?? Date.now()),
          raw: a,
        };
      }),
    )
    .onConflictDoNothing();
}

/** Refresh status of the last week's orders, including bracket/OTO legs. */
async function syncOrders() {
  const after = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const recent = await alpaca.getOrders({ status: "all", after, nested: true });
  await upsertOrders(recent.map(normalizeOrder));
}

async function upsertOrders(list: alpaca.Order[]) {
  const rows: (typeof schema.orders.$inferInsert)[] = [];
  const add = (o: alpaca.Order, parent?: alpaca.Order) => {
    const symbol = normalizeSymbol(o.symbol, o.asset_class);
    rows.push({
      id: o.id,
      clientOrderId: o.client_order_id,
      parentId: parent?.id ?? null,
      symbol,
      assetClass: assetClassOf(symbol),
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
async function syncBenchmarks() {
  const d = db();
  const [first] = await d
    .select({ ts: schema.equitySnapshots.ts })
    .from(schema.equitySnapshots)
    .orderBy(schema.equitySnapshots.ts)
    .limit(1);
  const fallbackStart = new Date((first?.ts ?? new Date()).getTime() - 7 * 86_400_000);

  for (const cls of ["us_equity", "crypto"] as const) {
    const symbol = BENCHMARKS[cls];
    const [latest] = await d
      .select({ date: schema.benchmarkCloses.date })
      .from(schema.benchmarkCloses)
      .where(eq(schema.benchmarkCloses.symbol, symbol))
      .orderBy(desc(schema.benchmarkCloses.date))
      .limit(1);
    // Re-fetch from the latest cached day (its close may have been partial) or a week before inception.
    const start = latest ? new Date(`${latest.date}T00:00:00Z`) : fallbackStart;
    const bars =
      cls === "crypto"
        ? ((await alpaca.getCryptoBars([symbol], "1Day", start))[symbol] ?? [])
        : ((await alpaca.getBars([symbol], "1Day", start))[symbol] ?? []);
    if (!bars.length) continue;
    await d
      .insert(schema.benchmarkCloses)
      .values(
        bars.map((b) => ({
          symbol,
          // Stock daily bars start at midnight ET; crypto daily bars are UTC days.
          date: cls === "crypto" ? b.t.slice(0, 10) : tradingDay(new Date(b.t)),
          close: b.c,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.benchmarkCloses.symbol, schema.benchmarkCloses.date],
        set: { close: sql`excluded.close` },
      });
  }
}
