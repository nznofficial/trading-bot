import { STRATEGY_PARAMS } from "../config";
import { sma } from "../indicators";
import type { Strategy } from "./types";

const { fast, slow, crossLookback } = STRATEGY_PARAMS.sma_cross;

const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

export const smaCross: Strategy = {
  id: "sma_cross",
  name: `SMA ${fast}/${slow} Crossover`,
  description: `Trend following: enter when SMA(${fast}) crosses above SMA(${slow}) within the last ${crossLookback} bars; exit when it falls back below.`,
  minBars: slow + crossLookback,
  evaluate({ bars, positionQty }) {
    const closes = bars.map((b) => b.c);
    const f = sma(closes, fast);
    const s = sma(closes, slow);
    const n = closes.length;
    const fNow = f[n - 1];
    const sNow = s[n - 1];
    const indicators = { close: closes[n - 1] ?? null, smaFast: round(fNow), smaSlow: round(sNow) };

    if (fNow === null || sNow === null) {
      return { action: "hold", reason: "warming up", indicators };
    }

    if (positionQty > 0) {
      return fNow < sNow
        ? { action: "sell", reason: `SMA${fast} fell below SMA${slow}`, indicators }
        : { action: "hold", reason: "trend intact", indicators };
    }

    if (fNow <= sNow) return { action: "hold", reason: "no uptrend", indicators };

    // Require a fresh crossover so we don't chase a trend that started long ago.
    for (let k = 1; k <= crossLookback; k++) {
      const fp = f[n - 1 - k];
      const sp = s[n - 1 - k];
      if (fp !== null && sp !== null && fp <= sp) {
        return { action: "buy", reason: `SMA${fast} crossed above SMA${slow} ${k} bar(s) ago`, indicators };
      }
    }
    return { action: "hold", reason: "uptrend but crossover is stale", indicators };
  },
};
