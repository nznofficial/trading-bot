import { STRATEGY_PARAMS } from "../config";
import { sma } from "../indicators";
import type { Strategy } from "./types";

export type SmaCrossParams = { fast: number; slow: number; crossLookback: number };

const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

export function makeSmaCross({ fast, slow, crossLookback }: SmaCrossParams = STRATEGY_PARAMS.sma_cross): Strategy {
  const strategy: Strategy = {
    id: "sma_cross",
    name: `SMA ${fast}/${slow} Crossover`,
    description: `Trend following: enter when SMA(${fast}) crosses above SMA(${slow}) within the last ${crossLookback} bars; exit when it falls back below.`,
    minBars: slow + crossLookback,
    prepare(bars) {
      const closes = bars.map((b) => b.c);
      const f = sma(closes, fast);
      const s = sma(closes, slow);
      return (i, positionQty) => {
        const fNow = f[i] ?? null;
        const sNow = s[i] ?? null;
        const indicators = { close: closes[i] ?? null, smaFast: round(fNow), smaSlow: round(sNow) };

        if (fNow === null || sNow === null) return { action: "hold", reason: "warming up", indicators };

        if (positionQty > 0) {
          return fNow < sNow
            ? { action: "sell", reason: `SMA${fast} fell below SMA${slow}`, indicators }
            : { action: "hold", reason: "trend intact", indicators };
        }

        if (fNow <= sNow) return { action: "hold", reason: "no uptrend", indicators };

        // Require a fresh crossover so we don't chase a trend that started long ago.
        for (let k = 1; k <= crossLookback; k++) {
          const fp = f[i - k] ?? null;
          const sp = s[i - k] ?? null;
          if (fp !== null && sp !== null && fp <= sp) {
            return { action: "buy", reason: `SMA${fast} crossed above SMA${slow} ${k} bar(s) ago`, indicators };
          }
        }
        return { action: "hold", reason: "uptrend but crossover is stale", indicators };
      };
    },
    evaluate({ bars, positionQty }) {
      return strategy.prepare(bars)(bars.length - 1, positionQty);
    },
  };
  return strategy;
}

export const smaCross = makeSmaCross();
