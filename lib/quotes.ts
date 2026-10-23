import type { Bar } from "./alpaca";
import { tradingDay } from "./analytics";
import type { AssetClass } from "./config";

export type Quote = {
  symbol: string;
  assetClass: AssetClass;
  price: number;
  /** Stocks: vs the previous session's close. Crypto: vs 24 hours ago. */
  change: number;
  changePct: number;
  ts: string;
};

/**
 * Last price and change for the ticker tape, derived from bars the tick already fetched.
 * `bars` must be oldest-first; stocks should be regular-session bars only.
 */
export function computeQuote(symbol: string, assetClass: AssetClass, bars: Bar[], now: Date): Quote | null {
  const last = bars[bars.length - 1];
  if (!last) return null;

  let ref: Bar | undefined;
  if (assetClass === "crypto") {
    const cutoff = now.getTime() - 86_400_000;
    ref = bars.findLast((b) => new Date(b.t).getTime() <= cutoff);
  } else {
    // Previous session's final bar = the last bar from an earlier New York trading day.
    const today = tradingDay(new Date(last.t));
    ref = bars.findLast((b) => tradingDay(new Date(b.t)) < today);
  }
  const base = ref?.c ?? bars[0].c;
  return {
    symbol,
    assetClass,
    price: last.c,
    change: last.c - base,
    changePct: base > 0 ? last.c / base - 1 : 0,
    ts: last.t,
  };
}
