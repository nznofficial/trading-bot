import { STRATEGY_PARAMS } from "../config";
import { rsi } from "../indicators";
import type { Strategy } from "./types";

const { period, entry, exit } = STRATEGY_PARAMS.rsi_revert;

export const rsiRevert: Strategy = {
  id: "rsi_revert",
  name: `RSI(${period}) Mean Reversion`,
  description: `Buy oversold dips when RSI(${period}) < ${entry}; sell once it recovers above ${exit}. A protective stop handles failed bounces.`,
  minBars: period + 1,
  evaluate({ bars, positionQty }) {
    const closes = bars.map((b) => b.c);
    const r = rsi(closes, period);
    const now = r[r.length - 1] ?? null;
    const indicators = {
      close: closes[closes.length - 1] ?? null,
      rsi: now === null ? null : Math.round(now * 10) / 10,
    };

    if (now === null) return { action: "hold", reason: "warming up", indicators };

    if (positionQty > 0) {
      return now > exit
        ? { action: "sell", reason: `RSI ${now.toFixed(1)} > ${exit}`, indicators }
        : { action: "hold", reason: "waiting for recovery", indicators };
    }
    return now < entry
      ? { action: "buy", reason: `RSI ${now.toFixed(1)} < ${entry} (oversold)`, indicators }
      : { action: "hold", reason: "not oversold", indicators };
  },
};
