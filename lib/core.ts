import { CORE } from "./config";

/**
 * Bastion's rules, shared by the live engine and the backtest so both trade the same way.
 * The regime only ever looks at completed daily closes before `today`, so a decision made during
 * the session never peeks at the day's own (still moving) close.
 */

export type DailyClose = { date: string; close: number };

export type CoreRegime = {
  /** null until there are `smaDays` completed closes. */
  above: boolean | null;
  /** Last completed close and its date. */
  close: number | null;
  sma: number | null;
  asOf: string | null;
};

/** SPY's last completed close vs its N-day simple average, using only days strictly before `today`. */
export function coreRegime(daily: DailyClose[], today: string, smaDays: number = CORE.smaDays): CoreRegime {
  const done = daily.filter((d) => d.date < today);
  const last = done.at(-1);
  if (done.length < smaDays || !last) return { above: null, close: last?.close ?? null, sma: null, asOf: last?.date ?? null };
  const sma = done.slice(-smaDays).reduce((a, d) => a + d.close, 0) / smaDays;
  return { above: last.close > sma, close: last.close, sma, asOf: last.date };
}

/** Regime lookup by date for a whole history at once (the backtest asks once per bar). */
export function regimeByDate(daily: DailyClose[], smaDays: number = CORE.smaDays): (today: string) => boolean | null {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  // above[i] = regime after close i (i.e. for the next trading day).
  const above: (boolean | null)[] = [];
  let sum = 0;
  sorted.forEach((d, i) => {
    sum += d.close;
    if (i >= smaDays) sum -= sorted[i - smaDays].close;
    above.push(i + 1 >= smaDays ? d.close > sum / smaDays : null);
  });
  return (today) => {
    // Last index with date < today.
    let lo = 0;
    let hi = sorted.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (sorted[m].date < today) {
        ans = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    return ans < 0 ? null : above[ans];
  };
}

export type CorePlan =
  | { action: "buy"; qty: number; reason: string }
  | { action: "sell"; qty: number; reason: string }
  | { action: "hold"; reason: string };

/**
 * What the core should do now. It buys once when SPY is above its average and it holds nothing, and
 * sells everything when SPY is below. It never rebalances in between, so it doesn't churn.
 * Switching the core off stops new buys only; the exit rule still applies.
 */
export function planCore(input: {
  enabled: boolean;
  pct: number;
  above: boolean | null;
  heldQty: number;
  price: number | null;
  equity: number;
  /** Cash the core may spend (already net of the buying-power buffer). */
  spendable: number;
  orderPending: boolean;
}): CorePlan {
  const { enabled, pct, above, heldQty, price, equity, spendable, orderPending } = input;
  if (orderPending) return { action: "hold", reason: "order pending" };
  if (above === null) return { action: "hold", reason: "insufficient daily history" };
  if (!above) {
    return heldQty > 0
      ? { action: "sell", qty: heldQty, reason: "SPY closed below its 200-day average" }
      : { action: "hold", reason: "in cover: SPY below its 200-day average" };
  }
  if (heldQty > 0) return { action: "hold", reason: "in market: SPY above its 200-day average" };
  if (!enabled) return { action: "hold", reason: "core safed in Hangar" };
  if (!price || !(price > 0)) return { action: "hold", reason: "no valid price" };
  const qty = Math.floor(Math.min(equity * pct, spendable) / price);
  return qty >= 1
    ? { action: "buy", qty, reason: "SPY closed above its 200-day average" }
    : { action: "hold", reason: "insufficient buying power" };
}
