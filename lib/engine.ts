import { and, asc, desc, eq, gte, inArray, like, lt, max, or, sql } from "drizzle-orm";
import * as alpaca from "./alpaca";
import { aggregateFills, matchRoundTrips, tradingDay, type FillRow } from "./analytics";
import {
  assetClassOf,
  BAR_LOOKBACK_DAYS,
  BAR_MINUTES,
  BAR_TIMEFRAME,
  BENCHMARKS,
  CORE,
  CRYPTO_BAR_LOOKBACK_DAYS,
  CRYPTO_FEES,
  CRYPTO_RISK,
  CRYPTO_SYMBOLS,
  HERALD,
  HERALD_STOCKS,
  normalizeSymbol,
  OWNERS,
  PORTFOLIO_RISK,
  STOCK_SYMBOLS,
  UNIVERSE,
  type AssetClass,
} from "./config";
import { db, schema } from "./db";
import { dateTime, signedPct, signedUsd, usd } from "./format";
import { COLORS, notify, type Embed } from "./notify";
import { coreRegime, planCore, type CoreRegime } from "./core";
import { buildUnits, getLiveParams, unitsMaxPct, type LiveParams } from "./live-params";
import { computeQuote, type Quote } from "./quotes";
import {
  activeVetoes,
  gateWatches,
  heraldCall,
  isHeraldTrigger,
  recordNewsActions,
  scoredHeadlines,
  scoreNews,
  syncNews,
  tightenedStop,
  vetoNote,
  type NewsActionRow,
  type ScoredHeadline,
  type Veto,
} from "./news";
import { createRiskGate, DEFAULT_LIMITS, planCryptoStop, sizeHerald } from "./risk";
import { STRATEGIES, strategyFor, type Signal } from "./strategies";
import { unitName } from "./units";

export type TickOptions = {
  /** Evaluate strategies even if the market is closed, but never submit or cancel orders. */
  dryRun?: boolean;
  /** Who started the run (shown in Sorties). */
  trigger?: string;
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
  return prefix in STRATEGIES || prefix === CORE.id || prefix === HERALD.id ? prefix : null;
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
const normalizePosition = (p: alpaca.Position): alpaca.Position => ({
  ...p,
  symbol: normalizeSymbol(p.symbol, p.asset_class),
});
const normalizeOrder = (o: alpaca.Order): alpaca.Order => ({
  ...o,
  symbol: normalizeSymbol(o.symbol, o.asset_class),
  legs: o.legs?.map(normalizeOrder) ?? null,
});

export async function runTick(opts: TickOptions = {}): Promise<TickResult> {
  const started = Date.now();
  const d = db();
  const [run] = await d
    .insert(schema.botRuns)
    .values({ trigger: opts.trigger ?? null })
    .returning({ id: schema.botRuns.id });

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
      return finish({
        status: "skipped",
        marketOpen: null,
        signals: 0,
        ordersPlaced: 0,
        message: `run ${concurrent.id} in progress`,
      });
    }

    const [clock, account, paused, live] = await Promise.all([
      alpaca.getClock(),
      alpaca.getAccount(),
      getSetting("paused", false),
      getLiveParams(),
    ]);
    if (account.trading_blocked || account.account_blocked) throw new Error(`account blocked (${account.status})`);

    const [rawPositions, rawOpenOrders, newFills] = await Promise.all([
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
    // The dashboard's session bar counts down from these; it never calls Alpaca itself.
    await setSetting("clock", {
      isOpen: clock.is_open,
      nextOpen: clock.next_open,
      nextClose: clock.next_close,
      asOf: clock.timestamp,
    });
    // Alerts never fail a tick (notify swallows its own errors; these guards cover the queries).
    await alertFills(newFills).catch((e) => console.warn("fill alert failed", e));
    await maybeSendDebrief(account, new Date(clock.timestamp)).catch((e) => console.warn("debrief failed", e));
    await maybePrune(new Date(clock.timestamp)).catch((e) => console.warn("prune failed", e));
    // News runs every tick (pre-market headlines matter at the open) and never fails the tick.
    const newsNote = await runNews(new Date(clock.timestamp), started + NEWS_BUDGET_MS);

    if (paused)
      return finish({
        status: "paused",
        marketOpen: clock.is_open,
        signals: 0,
        ordersPlaced: 0,
        message: ["bot is paused", newsNote].filter(Boolean).join(" · "),
      });

    // Stocks only trade in the regular session; crypto trades every tick.
    const stocksActive = clock.is_open || !!opts.dryRun;
    const symbols = [...(stocksActive ? STOCK_SYMBOLS : []), ...CRYPTO_SYMBOLS];
    if (!symbols.length) {
      return finish({
        status: "closed",
        marketOpen: false,
        signals: 0,
        ordersPlaced: 0,
        message: [`next open ${dateTime(Date.parse(clock.next_open))}`, newsNote].filter(Boolean).join(" · "),
      });
    }

    // --- Market data -------------------------------------------------------------------------
    const now = new Date(clock.timestamp);
    const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
    const [stockBars, cryptoBars] = await Promise.all([
      stocksActive ? alpaca.getBars([...STOCK_SYMBOLS, CORE.symbol], BAR_TIMEFRAME, daysAgo(BAR_LOOKBACK_DAYS)) : {},
      CRYPTO_SYMBOLS.length
        ? alpaca.getCryptoBars(CRYPTO_SYMBOLS, BAR_TIMEFRAME, daysAgo(CRYPTO_BAR_LOOKBACK_DAYS))
        : {},
    ]);
    const allBars: Record<string, alpaca.Bar[]> = { ...stockBars, ...cryptoBars };
    const barMs = BAR_MINUTES * 60_000;
    await updateQuotes(stocksActive ? [...symbols, CORE.symbol] : symbols, allBars, now).catch((e) =>
      console.warn("quote update failed", e),
    );

    // --- Signals + execution -----------------------------------------------------------------
    const held = new Map(positions.map((p) => [p.symbol, Number(p.qty)]));
    const signalRows: (typeof schema.signals.$inferInsert)[] = [];
    const submitted: alpaca.Order[] = [];
    /** Symbols whose orders this tick already handled; the stop check skips them. */
    const touched = new Set<string>();

    // Market filter: SPY's last completed daily close vs its 200-day average. It drives the core and
    // gates every unit entry (no new unit buys while SPY is below; exits and stops are unaffected).
    const spyDaily = ((await alpaca.getBars([CORE.symbol], "1Day", daysAgo(CORE.lookbackDays)))[CORE.symbol] ?? []).map((b) => ({
      date: tradingDay(new Date(b.t)),
      close: b.c,
    }));
    const regime = coreRegime(spyDaily, tradingDay(now));

    // Core first, so its purchase comes out of the buying power the units see.
    let coreSpend = 0;
    if (stocksActive) {
      const core = await runCore({ live, account, held, openOrders, allBars, now, barMs, regime, runId: run.id, dryRun: !!opts.dryRun });
      signalRows.push(core.signal);
      if (core.order) {
        submitted.push(core.order);
        touched.add(CORE.symbol);
      }
      coreSpend = core.spend;
    }

    const cooldownUntil = await stopOutCooldowns(now);
    const gate = createRiskGate(
      {
        equity: Number(account.equity),
        lastEquity: Number(account.last_equity),
        buyingPower: Number(account.buying_power) - coreSpend,
        nonMarginableBuyingPower: Number(account.non_marginable_buying_power) - coreSpend,
        cryptoExposure: positions
          .filter((p) => assetClassOf(p.symbol) === "crypto")
          .reduce((a, p) => a + Number(p.market_value), 0),
        unitsExposure: positions
          .filter((p) => p.symbol !== CORE.symbol && OWNERS[p.symbol] !== HERALD.id)
          .reduce((a, p) => a + Number(p.market_value), 0),
        heldSymbols: new Set(held.keys()),
        otherSleeve: new Set(positions.filter((p) => OWNERS[p.symbol] === HERALD.id).map((p) => p.symbol)),
        symbolsWithOpenOrders: new Set(openOrders.map((o) => o.symbol)),
        cooldownUntil,
      },
      {
        ...DEFAULT_LIMITS,
        stocks: { ...DEFAULT_LIMITS.stocks, stopLossPct: live.stopLossPct },
        crypto: { ...DEFAULT_LIMITS.crypto, stopLossPct: live.stopLossPct },
        unitsMaxPct: unitsMaxPct(live),
      },
    );
    // Units built from the Hangar's live tuning (falls back to config defaults).
    const units = buildUnits(live);

    // News gate: symbols with a live veto take no new unit buys. Bastion's SPY is exempt.
    const vetoes: Map<string, Veto> = live.news.gateEnabled
      ? await activeVetoes(now, live.news).catch((e) => {
          console.warn("veto lookup failed", e);
          return new Map<string, Veto>();
        })
      : new Map();
    vetoes.delete(CORE.symbol);

    for (const symbol of symbols) {
      const strategy = units[UNIVERSE[symbol]];
      const cls = assetClassOf(symbol);
      // Completed bars only; stocks also drop pre/post-market bars.
      const bars = (allBars[symbol] ?? []).filter(
        (b) => (cls === "crypto" || isRegularSessionBar(b.t)) && new Date(b.t).getTime() + barMs <= now.getTime(),
      );
      const lastBar = bars[bars.length - 1];
      const qty = held.get(symbol) ?? 0;

      let signal: Signal;
      if (!lastBar || bars.length < strategy.minBars) {
        signal = {
          action: "hold",
          reason: `insufficient data (${bars.length}/${strategy.minBars} bars)`,
          indicators: {},
        };
      } else if ((!opts.dryRun || cls === "crypto") && now.getTime() - new Date(lastBar.t).getTime() > 3 * barMs) {
        signal = { action: "hold", reason: "stale data", indicators: {} };
      } else {
        signal = strategy.evaluate({ bars, positionQty: qty });
      }

      let acted = false;
      let note: string | null = null;
      const barTs = lastBar?.t ?? now.toISOString();

      const entriesOn = cls === "crypto" ? live.cryptoEnabled : live.stocksEnabled;
      if (signal.action === "buy" && !entriesOn) {
        note = `skipped: ${cls === "crypto" ? "crypto" : "stock"} entries disabled in Hangar`;
      } else if (signal.action === "buy" && regime.above === false) {
        note = "skipped: market filter (SPY below its 200-day average)";
      } else if (signal.action === "buy" && vetoes.has(symbol)) {
        note = `skipped: ${vetoNote(vetoes.get(symbol)!)}`;
      } else if (signal.action === "buy") {
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

    // UNIT-03 Herald: news-drift entries and timed exits in its own slice (only while armed).
    let heraldNote: string | null = null;
    if (stocksActive && live.herald.enabled) {
      try {
        const h = await runHerald({ live, account, positions, held, openOrders, vetoes, regime, cooldownUntil, now, barMs, daysAgo, spyDaily, runId: run.id, dryRun: !!opts.dryRun });
        signalRows.push(...h.signals);
        for (const o of h.orders) {
          submitted.push(o);
          touched.add(o.symbol);
        }
      } catch (e) {
        heraldNote = `Herald error: ${errMsg(e).slice(0, 160)}`;
      }
    }

    const stopNotes = opts.dryRun
      ? []
      : await maintainCryptoStops(positions, openOrders, touched, submitted, now, live.stopLossPct);
    const gateNotes = await applyNewsGate({ vetoes, positions, openOrders, touched, live, runId: run.id, dryRun: !!opts.dryRun }).catch(
      (e) => [`news gate error: ${errMsg(e)}`],
    );

    if (signalRows.length) await d.insert(schema.signals).values(signalRows);
    if (submitted.length) await upsertOrders(submitted);
    // Instant fill alerts: wait for this run's market orders to finish filling, then sync + alert now
    // instead of on the next run. Fills inserted here are skipped next run, so nothing alerts twice.
    if (submitted.length && !opts.dryRun) {
      await settleAndAlert(submitted).catch((e) => console.warn("instant fill alert failed", e));
    }

    const orderErrors = [
      ...signalRows.filter((r) => r.note?.startsWith("order error")).map((r) => `${r.symbol}: ${r.note}`),
      ...stopNotes.filter((n) => n.includes("stop error")),
    ];
    if (orderErrors.length) {
      await notify([
        { title: "⚠ Order rejected", description: orderErrors.join("\n").slice(0, 4000), color: COLORS.error },
      ]);
    }

    const result: Omit<TickResult, "runId"> = {
      status: "ok",
      marketOpen: clock.is_open,
      signals: signalRows.filter((s) => s.action !== "hold").length,
      ordersPlaced: submitted.length,
      message: [
        opts.dryRun ? "dry run" : null,
        stocksActive ? null : "stocks closed",
        `day P&L ${(gate.dailyPnlPct * 100).toFixed(2)}%`,
        newsNote,
        heraldNote,
        ...stopNotes,
        ...gateNotes,
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
    await notify([
      {
        title: "⚠ Sortie aborted",
        description: `Run #${run.id} failed:\n\`\`\`${errMsg(e).slice(0, 1500)}\`\`\``,
        color: COLORS.error,
      },
    ]);
    return finish({ status: "error", marketOpen: null, signals: 0, ordersPlaced: 0, error: errMsg(e) });
  }
}

/** Time the news step may use, from the start of the tick (the GitHub trigger gives up at 90s). */
const NEWS_BUDGET_MS = 30_000;

/** Pull and score new headlines. Returns a short note for the run message, or null when there was nothing to do. */
async function runNews(now: Date, deadline: number): Promise<string | null> {
  try {
    const added = await syncNews(now);
    const s = await scoreNews(now, deadline);
    const parts = [
      added ? `news +${added}` : null,
      s.scored ? `scored ${s.scored}` : null,
      s.pending ? `${s.pending} unscored` : null,
      s.error ? `scoring: ${s.error.slice(0, 120)}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  } catch (e) {
    console.warn("news sync failed", e);
    return `news error: ${errMsg(e).slice(0, 160)}`;
  }
}

/**
 * Log each new veto once, and lift the protective stop of any position the veto hits to
 * `tightenPct` below the price (never lowering it). Returns notes for the run message.
 */
async function applyNewsGate(ctx: {
  vetoes: Map<string, Veto>;
  positions: alpaca.Position[];
  openOrders: alpaca.Order[];
  touched: Set<string>;
  live: LiveParams;
  runId: number;
  dryRun: boolean;
}): Promise<string[]> {
  const { vetoes, live } = ctx;
  if (!vetoes.size) return [];
  const notes: string[] = [];
  const rows: NewsActionRow[] = [];
  for (const [symbol, v] of vetoes) {
    if (!gateWatches(symbol, live.herald.enabled)) continue;
    rows.push({
      runId: ctx.runId,
      newsId: v.newsId,
      symbol,
      kind: "veto",
      unit: OWNERS[symbol],
      detail: `buys blocked: ${vetoNote(v)}`,
      expiresAt: v.expiresAt,
    });
  }
  // Dry runs report what they'd do but never write the audit trail or touch orders.
  const newVetoes = ctx.dryRun ? rows : await recordNewsActions(rows);

  for (const p of ctx.positions) {
    const v = vetoes.get(p.symbol);
    // Positions this tick already sold or re-protected are left alone.
    if (!v || !gateWatches(p.symbol, live.herald.enabled) || ctx.touched.has(p.symbol)) continue;
    const stop = ctx.openOrders.find(
      (o) => o.symbol === p.symbol && o.side === "sell" && (o.type === "stop" || o.type === "stop_limit") && o.stop_price,
    );
    if (!stop) continue;
    const price = Number(p.current_price);
    const target = tightenedStop(Number(stop.stop_price), price, live.news.tightenPct);
    if (target === null) continue;
    const label = `${p.symbol} stop ${stop.stop_price} → ${target}`;
    if (ctx.dryRun) {
      notes.push(`dry run: would tighten ${label}`);
      continue;
    }
    try {
      const limit = stop.type === "stop_limit" ? Math.round(target * (1 - CRYPTO_RISK.stopLimitSlippagePct) * 100) / 100 : undefined;
      await alpaca.replaceOrder(stop.id, { stop_price: target, limit_price: limit });
      notes.push(`news: tightened ${label}`);
      newVetoes.push(
        ...(await recordNewsActions([
          {
            runId: ctx.runId,
            newsId: v.newsId,
            symbol: p.symbol,
            kind: "tighten",
            unit: OWNERS[p.symbol],
            detail: `stop ${stop.stop_price} → ${target} (${(live.news.tightenPct * 100).toFixed(1)}% under ${price}) after "${v.headline.slice(0, 80)}"`,
            expiresAt: null,
          },
        ])),
      );
    } catch (e) {
      notes.push(`news: tighten ${p.symbol} stop error: ${errMsg(e).slice(0, 120)}`);
    }
  }

  if (!ctx.dryRun && newVetoes.length) {
    await notify(
      newVetoes.map((a) => ({
        title: a.kind === "veto" ? `⛔ News veto · ${a.symbol}` : `🛡 Stop tightened · ${a.symbol}`,
        description: `${unitName(a.unit ?? null)}\n${a.detail}`.slice(0, 1000),
        color: COLORS.error,
      })),
    ).catch((e) => console.warn("news alert failed", e));
  }
  if (newVetoes.some((a) => a.kind === "veto")) notes.push(`news: ${newVetoes.filter((a) => a.kind === "veto").length} new veto(es)`);
  return notes;
}

/**
 * UNIT-03 Herald: buys a target after a fresh, strongly positive, material headline and sells it
 * `holdDays` trading days after the latest one. Same rule as the backtest (lib/news.ts `heraldCall`).
 * Only buy/sell calls are written to signals; Herald's 40 quiet targets would otherwise flood the log.
 */
async function runHerald(ctx: {
  live: LiveParams;
  account: alpaca.Account;
  positions: alpaca.Position[];
  held: Map<string, number>;
  openOrders: alpaca.Order[];
  vetoes: Map<string, Veto>;
  regime: CoreRegime;
  cooldownUntil: Map<string, Date>;
  now: Date;
  barMs: number;
  daysAgo: (n: number) => Date;
  spyDaily: { date: string; close: number }[];
  runId: number;
  dryRun: boolean;
}): Promise<{ signals: (typeof schema.signals.$inferInsert)[]; orders: alpaca.Order[] }> {
  const { live, account, held, openOrders, vetoes, now, barMs, runId, dryRun } = ctx;
  const h = live.herald;
  const symbols = [...HERALD_STOCKS] as string[];
  const lookbackDays = Math.ceil(h.holdDays * 1.6) + 7;
  const [bars, headlines] = await Promise.all([
    alpaca.getBars(symbols, BAR_TIMEFRAME, ctx.daysAgo(5)),
    scoredHeadlines(ctx.daysAgo(lookbackDays), now, symbols),
  ]);
  const triggers = new Map<string, ScoredHeadline[]>();
  for (const x of headlines.filter((x) => isHeraldTrigger(x, h)).reverse()) (triggers.get(x.symbol) ?? triggers.set(x.symbol, []).get(x.symbol)!).push(x);
  // Completed sessions plus today, for counting trading days since a headline.
  const today = tradingDay(now);
  const sessions = [...new Set([...ctx.spyDaily.map((d) => d.date), today])].sort();
  const sessionIdx = (day: string) => {
    const i = sessions.findIndex((d) => d >= day);
    return i < 0 ? sessions.length : i;
  };

  const mine = ctx.positions.filter((p) => OWNERS[p.symbol] === HERALD.id);
  let exposure = mine.reduce((a, p) => a + Number(p.market_value), 0);
  let count = mine.length;
  let buyingPower = Number(account.buying_power);
  const signals: (typeof schema.signals.$inferInsert)[] = [];
  const orders: alpaca.Order[] = [];
  const actions: NewsActionRow[] = [];

  for (const symbol of symbols) {
    const done = (bars[symbol] ?? []).filter((b) => isRegularSessionBar(b.t) && Date.parse(b.t) + barMs <= now.getTime());
    const lastBar = done.at(-1);
    const prev = done.at(-2);
    if (!lastBar || (!dryRun && now.getTime() - Date.parse(lastBar.t) > 3 * barMs)) continue;
    const qty = held.get(symbol) ?? 0;
    const call = heraldCall({
      triggers: triggers.get(symbol) ?? [],
      held: qty > 0,
      prevClose: prev ? new Date(Date.parse(prev.t) + barMs) : null,
      now: new Date(Date.parse(lastBar.t) + barMs),
      holdDays: h.holdDays,
      tradingDaysSince: (t) => sessionIdx(today) - sessionIdx(tradingDay(t)),
    });
    if (call.action === "hold") continue;
    const t = call.trigger;
    const reason = t
      ? `${call.action === "buy" ? "fresh" : `${h.holdDays}-day hold done after`} headline ${t.sentiment >= 0 ? "+" : ""}${t.sentiment.toFixed(1)} "${t.headline.slice(0, 70)}"`
      : "no qualifying headline in range";
    let note: string | null = null;
    let acted = false;
    const barTs = lastBar.t;

    if (call.action === "buy") {
      const veto = vetoes.get(symbol);
      if (ctx.regime.above === false) note = "skipped: market filter (SPY below its 200-day average)";
      else if (veto) note = `skipped: ${vetoNote(veto)}`;
      else {
        const d = sizeHerald({
          symbol,
          price: lastBar.c,
          equity: Number(account.equity),
          lastEquity: Number(account.last_equity),
          pct: h.pct,
          maxPositions: h.maxPositions,
          exposure,
          count,
          buyingPower,
          stopLossPct: live.stopLossPct,
          held: qty > 0,
          orderPending: openOrders.some((o) => o.symbol === symbol),
          cooldownUntil: ctx.cooldownUntil.get(symbol),
        });
        if (!d.ok) note = `skipped: ${d.reason}`;
        else if (dryRun) note = `dry run: would buy ${d.qty} @ ~${lastBar.c} stop ${d.stopLoss}`;
        else {
          try {
            const order = await alpaca.submitOrder({
              symbol,
              qty: d.qty,
              side: "buy",
              client_order_id: makeClientOrderId(HERALD.id, "buy", symbol, barTs),
              stop_loss: d.stopLoss,
            });
            orders.push(order);
            acted = true;
            exposure += d.qty * lastBar.c;
            buyingPower -= d.qty * lastBar.c;
            count++;
            note = `buy ${d.qty} (stop ${d.stopLoss}) order ${order.id}`;
            if (t) actions.push({ runId, newsId: t.newsId, symbol, kind: "herald_entry", unit: HERALD.id, detail: `bought ${d.qty} @ ~${lastBar.c}: ${reason}`, expiresAt: null });
          } catch (e) {
            note = duplicateOrder(e) ? "already submitted for this bar" : `order error: ${errMsg(e)}`;
          }
        }
      }
    } else if (dryRun) {
      note = `dry run: would sell ${qty}`;
    } else {
      try {
        await cancelOpenOrdersFor(symbol, openOrders);
        const order = await alpaca.submitOrder({
          symbol,
          qty,
          side: "sell",
          time_in_force: "day",
          client_order_id: makeClientOrderId(HERALD.id, "sell", symbol, barTs),
        });
        orders.push(order);
        acted = true;
        note = `sell ${qty} order ${order.id}`;
        if (t) actions.push({ runId, newsId: t.newsId, symbol, kind: "herald_exit", unit: HERALD.id, detail: `sold ${qty}: ${reason}`, expiresAt: null });
      } catch (e) {
        note = duplicateOrder(e) ? "already submitted for this bar" : `order error: ${errMsg(e)}`;
      }
    }
    signals.push({
      runId,
      barTs: new Date(barTs),
      symbol,
      assetClass: "us_equity",
      strategy: HERALD.id,
      action: call.action,
      reason,
      indicators: t ? { sentiment: t.sentiment, materiality: t.materiality, newsId: t.newsId } : {},
      acted,
      note,
    });
  }
  if (actions.length) await recordNewsActions(actions);
  return { signals, orders };
}

/**
 * UNIT-00 Bastion: hold SPY with the core's share of equity while SPY's last daily close is above its
 * 200-day average; sell it all when it closes below. No protective stop: the average is the exit.
 */
async function runCore(ctx: {
  live: LiveParams;
  account: alpaca.Account;
  held: Map<string, number>;
  openOrders: alpaca.Order[];
  allBars: Record<string, alpaca.Bar[]>;
  now: Date;
  barMs: number;
  regime: CoreRegime;
  runId: number;
  dryRun: boolean;
}): Promise<{ signal: typeof schema.signals.$inferInsert; order: alpaca.Order | null; spend: number }> {
  const { live, account, held, openOrders, allBars, now, barMs, regime, runId, dryRun } = ctx;
  const symbol = CORE.symbol;
  const intraday = (allBars[symbol] ?? []).filter((b) => isRegularSessionBar(b.t) && Date.parse(b.t) + barMs <= now.getTime());
  const lastBar = intraday.at(-1);
  const stale = !dryRun && (!lastBar || now.getTime() - Date.parse(lastBar.t) > 3 * barMs);
  const heldQty = held.get(symbol) ?? 0;

  const plan = stale
    ? ({ action: "hold", reason: "stale data" } as const)
    : planCore({
        enabled: live.core.enabled,
        pct: live.core.pct,
        above: regime.above,
        heldQty,
        price: lastBar?.c ?? null,
        equity: Number(account.equity),
        spendable: Math.max(0, Number(account.non_marginable_buying_power)) * PORTFOLIO_RISK.buyingPowerBuffer,
        orderPending: openOrders.some((o) => o.symbol === symbol),
      });

  const gap = regime.close !== null && regime.sma ? regime.close / regime.sma - 1 : null;
  const indicators = {
    close: regime.close,
    sma200: regime.sma === null ? null : Math.round(regime.sma * 100) / 100,
    gapPct: gap === null ? null : Math.round(gap * 10_000) / 100,
  };
  let order: alpaca.Order | null = null;
  let note: string | null = null;
  let spend = 0;
  // One order per regime day: the daily date makes a re-submit on a later tick a duplicate.
  const barTs = regime.asOf ? `${regime.asOf}T21:00:00Z` : now.toISOString();
  if (plan.action !== "hold") {
    if (dryRun) {
      note = `dry run: would ${plan.action} ${plan.qty}`;
    } else {
      try {
        if (plan.action === "sell") await cancelOpenOrdersFor(symbol, openOrders);
        order = await alpaca.submitOrder({
          symbol,
          qty: plan.qty,
          side: plan.action,
          time_in_force: "day",
          client_order_id: makeClientOrderId(CORE.id, plan.action, symbol, barTs),
        });
        if (plan.action === "buy") spend = plan.qty * (lastBar?.c ?? 0);
        note = `${plan.action} ${plan.qty} order ${order.id}`;
      } catch (e) {
        note = duplicateOrder(e) ? "already submitted for this day" : `order error: ${errMsg(e)}`;
      }
    }
  }
  return {
    signal: {
      runId,
      barTs: new Date(barTs),
      symbol,
      assetClass: "us_equity",
      strategy: CORE.id,
      action: plan.action,
      reason: plan.reason,
      indicators,
      acted: !!order,
      note,
    },
    order,
    spend,
  };
}

/** Ticker-tape quotes. Stocks keep their last values while the market is closed. */
async function updateQuotes(symbols: string[], allBars: Record<string, alpaca.Bar[]>, now: Date) {
  const quotes = await getSetting<Record<string, Quote>>("quotes", {});
  for (const symbol of symbols) {
    const cls = assetClassOf(symbol);
    const bars = (allBars[symbol] ?? []).filter((b) => cls === "crypto" || isRegularSessionBar(b.t));
    const q = computeQuote(symbol, cls, bars, now);
    if (q) quotes[symbol] = q;
  }
  await setSetting("quotes", quotes);
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
  stopLossPct: number,
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
      { ...CRYPTO_RISK, stopLossPct },
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
        await cancelOpenOrdersFor(
          p.symbol,
          openOrders.filter((o) => plan.cancelIds.includes(o.id)),
        );
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
async function syncFills(): Promise<FillRow[]> {
  const d = db();
  const [{ latest }] = await d.select({ latest: max(schema.fills.ts) }).from(schema.fills);
  const after = latest ? new Date(latest.getTime() - 60_000).toISOString() : undefined;
  const activities = await alpaca.getFills(after);
  if (!activities.length) return [];
  // returning() yields only rows actually inserted, i.e. fills we haven't seen before.
  return d
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
    .onConflictDoNothing()
    .returning();
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
    .values(activities.map(feeRow))
    .onConflictDoNothing();
}

/**
 * One CFEE activity as a fees row. Buy fees arrive in kind with the coin's symbol; sell fees ("Coin Pair
 * Transaction Fee (USD)") arrive with no symbol or order id, so they're filed under "USD".
 */
export function feeRow(a: alpaca.FeeActivity): typeof schema.fees.$inferInsert {
  const symbol = a.symbol ? normalizeSymbol(a.symbol, "crypto") : "USD";
  return {
    id: a.id,
    symbol,
    assetClass: "crypto",
    orderId: a.order_id ?? null,
    amountUsd: feeUsd(a),
    ts: new Date(a.transaction_time ?? a.created_at ?? a.date ?? Date.now()),
    raw: a,
  };
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

// ---- Cooldowns & alerts ---------------------------------------------------------------------

/** Symbols whose position was closed by a protective stop recently → when re-entry is allowed. */
async function stopOutCooldowns(now: Date) {
  const windowMs = PORTFOLIO_RISK.reentryCooldownHours * 3_600_000;
  const rows = await db()
    .select({ symbol: schema.orders.symbol, filledAt: schema.orders.filledAt })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.side, "sell"),
        eq(schema.orders.status, "filled"),
        gte(schema.orders.filledAt, new Date(now.getTime() - windowMs)),
        // Stock bracket/OTO stop legs, the bot's crypto stop-limits, and its breach exits.
        or(inArray(schema.orders.type, ["stop", "stop_limit"]), like(schema.orders.clientOrderId, "%.stopexit.%")),
      ),
    );
  const until = new Map<string, Date>();
  for (const r of rows) {
    if (!r.filledAt) continue;
    const t = new Date(r.filledAt.getTime() + windowMs);
    if (t > now && (!until.has(r.symbol) || t > until.get(r.symbol)!)) until.set(r.symbol, t);
  }
  return until;
}

/**
 * Poll this run's market orders until they're done filling (max ~10s; partial fills complete within
 * seconds in liquid markets), then sync fills and alert. Stop/limit legs rest and are not waited on.
 */
async function settleAndAlert(submitted: alpaca.Order[]) {
  const pending = submitted.filter((o) => o.type === "market").map((o) => o.id);
  const done = new Set(["filled", "canceled", "expired", "rejected"]);
  for (let i = 0; i < 20 && pending.length; i++) {
    const statuses = await Promise.all(pending.map((id) => alpaca.getOrder(id)));
    for (const o of statuses) if (done.has(o.status)) pending.splice(pending.indexOf(o.id), 1);
    if (pending.length) await sleep(500);
  }
  await syncOrders(); // record final fill prices/statuses before alerting
  await alertFills(await syncFills());
}

/** One embed per newly filled order, plus a "target neutralized" embed for exits up ≥ 2%. */
async function alertFills(newFills: FillRow[]) {
  if (!newFills.length) return;
  const d = db();
  const orderIds = [...new Set(newFills.map((f) => f.orderId))];
  const orderRows = await d
    .select({ id: schema.orders.id, strategy: schema.orders.strategy, clientOrderId: schema.orders.clientOrderId })
    .from(schema.orders)
    .where(inArray(schema.orders.id, orderIds));
  const strategyBy = new Map(
    orderRows.map((o) => [o.id, o.strategy ?? strategyFromClientOrderId(o.clientOrderId) ?? "manual"]),
  );
  const execs = aggregateFills(newFills, strategyBy);
  const embeds: Embed[] = execs.map((e) => ({
    title: `${e.side === "buy" ? "▶ Engage" : "◀ Disengage"} · ${e.symbol}`,
    color: e.side === "buy" ? COLORS.buy : COLORS.sell,
    fields: [
      { name: "Side", value: e.side.toUpperCase(), inline: true },
      { name: "Qty", value: alpaca.formatQty(e.qty), inline: true },
      { name: "Price", value: usd(e.price), inline: true },
      { name: "Notional", value: usd(e.qty * e.price), inline: true },
      { name: "Unit", value: unitName(e.strategy === "manual" ? null : e.strategy), inline: true },
    ],
    timestamp: e.ts.toISOString(),
  }));

  // Big wins: round trips closed by these sells that returned ≥ 2%.
  const sellIds = new Set(execs.filter((e) => e.side === "sell").map((e) => e.orderId));
  if (sellIds.size) {
    const [allFills, allOrders] = await Promise.all([
      d.select().from(schema.fills).orderBy(asc(schema.fills.ts)),
      d.select({ id: schema.orders.id, strategy: schema.orders.strategy }).from(schema.orders),
    ]);
    const strat = new Map(allOrders.filter((o) => o.strategy).map((o) => [o.id, o.strategy!]));
    const { trades } = matchRoundTrips(aggregateFills(allFills, strat), CRYPTO_FEES);
    const byExit = new Map<string, { symbol: string; strategy: string; pnl: number; cost: number }>();
    for (const t of trades.filter((t) => sellIds.has(t.exitOrderId))) {
      const agg = byExit.get(t.exitOrderId) ?? { symbol: t.symbol, strategy: t.strategy, pnl: 0, cost: 0 };
      agg.pnl += t.pnl;
      agg.cost += t.entryPrice * t.qty;
      byExit.set(t.exitOrderId, agg);
    }
    for (const w of byExit.values()) {
      const ret = w.cost > 0 ? w.pnl / w.cost : 0;
      if (ret >= 0.02) {
        embeds.push({
          title: `★ Target neutralized · ${w.symbol}`,
          description: `${unitName(w.strategy === "manual" ? null : w.strategy)} closed **${signedUsd(w.pnl)}** (${signedPct(ret)}).`,
          color: COLORS.win,
        });
      }
    }
  }
  await notify(embeds);
}

/**
 * Once a day, drop rows only the latest of which matters: position snapshots and "hold" signals
 * older than two weeks, and expired chat rate-limit counters. Buy/sell signals, orders, fills, runs
 * and equity snapshots are kept.
 */
async function maybePrune(now: Date) {
  const today = tradingDay(now);
  if ((await getSetting("last_prune", "")) === today) return;
  await setSetting("last_prune", today);
  const cutoff = new Date(now.getTime() - 14 * 86_400_000);
  const d = db();
  await d.delete(schema.positionsSnapshot).where(lt(schema.positionsSnapshot.ts, cutoff));
  await d.delete(schema.signals).where(and(eq(schema.signals.action, "hold"), lt(schema.signals.ts, cutoff)));
  await d.delete(schema.chatCounters).where(lt(schema.chatCounters.expiresAt, now));
}

/** Once a day after the US close (16:05 ET, every day so weekend crypto is covered). */
async function maybeSendDebrief(account: alpaca.Account, now: Date) {
  const [h, m] = nyTime.format(now).split(":").map(Number);
  if (h * 60 + m < 16 * 60 + 5) return;
  const today = tradingDay(now);
  if ((await getSetting("last_debrief", "")) === today) return;
  await setSetting("last_debrief", today); // claim first so overlapping ticks can't double-send

  const d = db();
  const [allFills, allOrders, positions] = await Promise.all([
    d.select().from(schema.fills).orderBy(asc(schema.fills.ts)),
    d.select({ id: schema.orders.id, strategy: schema.orders.strategy }).from(schema.orders),
    alpaca.getPositions(),
  ]);
  const strat = new Map(allOrders.filter((o) => o.strategy).map((o) => [o.id, o.strategy!]));
  const { trades } = matchRoundTrips(aggregateFills(allFills, strat), CRYPTO_FEES);
  const closedToday = trades.filter((t) => tradingDay(t.exitTs) === today);
  const realized = closedToday.reduce((a, t) => a + t.pnl, 0);
  const best = closedToday.reduce<(typeof closedToday)[number] | null>((b, t) => (!b || t.pnl > b.pnl ? t : b), null);
  const worst = closedToday.reduce<(typeof closedToday)[number] | null>((w, t) => (!w || t.pnl < w.pnl ? t : w), null);
  const equity = Number(account.equity);
  const last = Number(account.last_equity);

  await notify([
    {
      title: `Daily debrief · ${today}`,
      color: COLORS.debrief,
      fields: [
        { name: "Equity", value: usd(equity), inline: true },
        {
          name: "Day P&L",
          value: `${signedUsd(equity - last)} (${signedPct(last ? equity / last - 1 : 0)})`,
          inline: true,
        },
        { name: "Open positions", value: String(positions.length), inline: true },
        { name: "Trades closed", value: String(closedToday.length), inline: true },
        { name: "Realized today", value: signedUsd(realized), inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        ...(best
          ? [
              {
                name: "Best",
                value: `${best.symbol} ${signedUsd(best.pnl)} (${signedPct(best.returnPct)})`,
                inline: true,
              },
            ]
          : []),
        ...(worst && worst !== best
          ? [
              {
                name: "Worst",
                value: `${worst.symbol} ${signedUsd(worst.pnl)} (${signedPct(worst.returnPct)})`,
                inline: true,
              },
            ]
          : []),
      ],
    },
  ]);
}
