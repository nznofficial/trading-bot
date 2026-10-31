import { assetClassOf, CRYPTO_RISK, PORTFOLIO_RISK, RISK } from "./config";

export type RiskState = {
  equity: number;
  lastEquity: number;
  /** Margin buying power (stocks). */
  buyingPower: number;
  /** Cash buying power (crypto can't be bought on margin). Defaults to buyingPower. */
  nonMarginableBuyingPower?: number;
  /** Current market value of crypto positions, for the class cap. */
  cryptoExposure?: number;
  /** Current market value of every unit (non-core) position, for the units cap. */
  unitsExposure?: number;
  heldSymbols: Set<string>;
  /** Held symbols that don't count toward the units' position limit (Herald's own sleeve). */
  otherSleeve?: Set<string>;
  symbolsWithOpenOrders: Set<string>;
  /** Symbols stopped out recently → when re-entry is allowed again. */
  cooldownUntil?: Map<string, Date>;
};

export type EntryDecision =
  | { ok: true; qty: number; stopLoss: number; takeProfit?: number; stopLimit?: number }
  | { ok: false; reason: string };

export type RiskLimits = {
  portfolio: typeof PORTFOLIO_RISK;
  stocks: typeof RISK;
  crypto: typeof CRYPTO_RISK;
  /** Cap on all unit positions together as a fraction of equity (the core holds the rest). 1 = no cap. */
  unitsMaxPct?: number;
};

export const DEFAULT_LIMITS: RiskLimits = { portfolio: PORTFOLIO_RISK, stocks: RISK, crypto: CRYPTO_RISK, unitsMaxPct: 1 };

export const round2 = (n: number) => Math.round(n * 100) / 100;
/** Round down to Alpaca's crypto quantity increment (1e-9) so we never exceed the budget. */
export const floorQty = (n: number) => Math.floor(n * 1e9) / 1e9;

export function dailyPnlPct(equity: number, lastEquity: number) {
  return lastEquity > 0 ? (equity - lastEquity) / lastEquity : 0;
}

/**
 * Stateful gate for one tick: each approved entry consumes buying power, a position slot and
 * (for crypto) class budget, so several buy signals in the same tick can't collectively breach the limits.
 */
export function createRiskGate(initial: RiskState, limits: RiskLimits = DEFAULT_LIMITS) {
  const { portfolio, stocks, crypto } = limits;
  let buyingPower = initial.buyingPower;
  let cash = initial.nonMarginableBuyingPower ?? initial.buyingPower;
  let cryptoExposure = initial.cryptoExposure ?? 0;
  let unitsExposure = initial.unitsExposure ?? 0;
  const unitsRoom = () => initial.equity * (limits.unitsMaxPct ?? 1) - unitsExposure;
  let openCount = [...initial.heldSymbols].filter((s) => !initial.otherSleeve?.has(s)).length;
  const pnl = dailyPnlPct(initial.equity, initial.lastEquity);

  return {
    dailyPnlPct: pnl,
    approveEntry(symbol: string, price: number): EntryDecision {
      if (pnl <= portfolio.dailyLossHaltPct) {
        return { ok: false, reason: `daily loss halt (${(pnl * 100).toFixed(2)}%)` };
      }
      if (initial.heldSymbols.has(symbol)) return { ok: false, reason: "already holding" };
      if (initial.symbolsWithOpenOrders.has(symbol)) return { ok: false, reason: "open order pending" };
      const until = initial.cooldownUntil?.get(symbol);
      if (until) return { ok: false, reason: `cooldown after stop-out until ${until.toISOString().slice(0, 16)}Z` };
      if (openCount >= portfolio.maxOpenPositions) {
        return { ok: false, reason: `max ${portfolio.maxOpenPositions} positions` };
      }
      if (!(price > 0)) return { ok: false, reason: "no valid price" };
      const capReason = `units cap ${((limits.unitsMaxPct ?? 1) * 100).toFixed(0)}% reached`;

      if (assetClassOf(symbol) === "crypto") {
        const classRoom = initial.equity * crypto.maxClassPct - cryptoExposure;
        if (classRoom < crypto.minNotional) {
          return { ok: false, reason: `crypto cap ${(crypto.maxClassPct * 100).toFixed(0)}% reached` };
        }
        if (unitsRoom() < crypto.minNotional) return { ok: false, reason: capReason };
        const budget = Math.min(initial.equity * crypto.maxPositionPct, classRoom, unitsRoom(), cash * portfolio.buyingPowerBuffer);
        const qty = floorQty(budget / price);
        if (qty * price < crypto.minNotional) return { ok: false, reason: "insufficient buying power" };

        const cost = qty * price;
        cash -= cost;
        buyingPower -= cost;
        cryptoExposure += cost;
        unitsExposure += cost;
        openCount++;
        const stopLoss = round2(price * (1 - crypto.stopLossPct));
        return { ok: true, qty, stopLoss, stopLimit: round2(stopLoss * (1 - crypto.stopLimitSlippagePct)) };
      }

      if (unitsRoom() < price) return { ok: false, reason: capReason };
      const budget = Math.min(initial.equity * stocks.maxPositionPct, unitsRoom(), buyingPower * portfolio.buyingPowerBuffer);
      // Whole shares only: Alpaca rejects fractional qty on OTO/bracket orders.
      const qty = Math.floor(budget / price);
      if (qty < 1) return { ok: false, reason: "insufficient buying power" };
      unitsExposure += qty * price;

      buyingPower -= qty * price;
      // Stock purchases also draw down cash, which crypto needs.
      cash -= qty * price;
      openCount++;
      return {
        ok: true,
        qty,
        stopLoss: round2(price * (1 - stocks.stopLossPct)),
        takeProfit: stocks.takeProfitPct === null ? undefined : round2(price * (1 + stocks.takeProfitPct)),
      };
    },
  };
}

export type StopPlan =
  | { action: "keep" }
  | { action: "place"; stopPrice: number; limitPrice: number }
  | { action: "replace"; stopPrice: number; limitPrice: number; cancelIds: string[] }
  | { action: "exit"; reason: string };

/**
 * Decide how to keep a crypto position protected. Alpaca has no OTO for crypto, so the bot
 * maintains a resting GTC stop-limit itself and re-checks it every tick.
 */
export function planCryptoStop(
  position: { qty: number; avgEntry: number; currentPrice: number },
  openSells: { id: string; type: string; qty: number }[],
  limits = CRYPTO_RISK,
): StopPlan {
  const stopPrice = round2(position.avgEntry * (1 - limits.stopLossPct));
  const limitPrice = round2(stopPrice * (1 - limits.stopLimitSlippagePct));
  const stops = openSells.filter((o) => o.type === "stop_limit" || o.type === "stop");
  // Already through the stop with nothing resting: a new stop would trigger instantly, so just exit.
  if (position.currentPrice <= stopPrice && stops.length === 0) {
    return { action: "exit", reason: `price ${position.currentPrice} below stop ${stopPrice}` };
  }
  if (stops.length === 0) return { action: "place", stopPrice, limitPrice };
  const covered = stops.reduce((a, o) => a + o.qty, 0);
  // Stop sized for less than the position (e.g. it was placed after a partial fill): resize it.
  if (covered < position.qty * 0.999) {
    return { action: "replace", stopPrice, limitPrice, cancelIds: stops.map((o) => o.id) };
  }
  return { action: "keep" };
}

/**
 * UNIT-03 Herald's entry size: an even share of its own slice (`pct / maxPositions` of equity), limited by
 * the slice's room and buying power. Whole shares with the normal protective stop. Shares the daily loss
 * halt and stop-out cooldown with the units, but not their position limit.
 */
export function sizeHerald(a: {
  symbol: string;
  price: number;
  equity: number;
  lastEquity: number;
  pct: number;
  maxPositions: number;
  /** Market value and count of Herald's open positions. */
  exposure: number;
  count: number;
  buyingPower: number;
  stopLossPct: number;
  held: boolean;
  orderPending: boolean;
  cooldownUntil?: Date;
}): EntryDecision {
  const pnl = dailyPnlPct(a.equity, a.lastEquity);
  if (pnl <= PORTFOLIO_RISK.dailyLossHaltPct) return { ok: false, reason: `daily loss halt (${(pnl * 100).toFixed(2)}%)` };
  if (a.held) return { ok: false, reason: "already holding" };
  if (a.orderPending) return { ok: false, reason: "open order pending" };
  if (a.cooldownUntil) return { ok: false, reason: `cooldown after stop-out until ${a.cooldownUntil.toISOString().slice(0, 16)}Z` };
  if (a.count >= a.maxPositions) return { ok: false, reason: `Herald max ${a.maxPositions} positions` };
  if (!(a.price > 0)) return { ok: false, reason: "no valid price" };
  const budget = Math.min((a.equity * a.pct) / a.maxPositions, a.equity * a.pct - a.exposure, a.buyingPower * PORTFOLIO_RISK.buyingPowerBuffer);
  const qty = Math.floor(budget / a.price);
  if (qty < 1) return { ok: false, reason: `Herald slice ${(a.pct * 100).toFixed(0)}% full` };
  return { ok: true, qty, stopLoss: round2(a.price * (1 - a.stopLossPct)) };
}
