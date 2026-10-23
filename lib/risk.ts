import { RISK } from "./config";

export type RiskState = {
  equity: number;
  lastEquity: number;
  buyingPower: number;
  heldSymbols: Set<string>;
  symbolsWithOpenOrders: Set<string>;
};

export type EntryDecision =
  | { ok: true; qty: number; stopLoss: number; takeProfit?: number }
  | { ok: false; reason: string };

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function dailyPnlPct(equity: number, lastEquity: number) {
  return lastEquity > 0 ? (equity - lastEquity) / lastEquity : 0;
}

/**
 * Stateful gate for one tick: each approved entry consumes buying power and a position slot,
 * so several buy signals in the same tick can't collectively breach the limits.
 */
export function createRiskGate(initial: RiskState, risk = RISK) {
  let buyingPower = initial.buyingPower;
  let openCount = initial.heldSymbols.size;
  const pnl = dailyPnlPct(initial.equity, initial.lastEquity);

  return {
    dailyPnlPct: pnl,
    approveEntry(symbol: string, price: number): EntryDecision {
      if (pnl <= risk.dailyLossHaltPct) {
        return { ok: false, reason: `daily loss halt (${(pnl * 100).toFixed(2)}%)` };
      }
      if (initial.heldSymbols.has(symbol)) return { ok: false, reason: "already holding" };
      if (initial.symbolsWithOpenOrders.has(symbol)) return { ok: false, reason: "open order pending" };
      if (openCount >= risk.maxOpenPositions) {
        return { ok: false, reason: `max ${risk.maxOpenPositions} positions` };
      }
      if (!(price > 0)) return { ok: false, reason: "no valid price" };

      const budget = Math.min(initial.equity * risk.maxPositionPct, buyingPower * risk.buyingPowerBuffer);
      // Whole shares only: Alpaca rejects fractional qty on OTO/bracket orders.
      const qty = Math.floor(budget / price);
      if (qty < 1) return { ok: false, reason: "insufficient buying power" };

      buyingPower -= qty * price;
      openCount++;
      return {
        ok: true,
        qty,
        stopLoss: round2(price * (1 - risk.stopLossPct)),
        takeProfit: risk.takeProfitPct === null ? undefined : round2(price * (1 + risk.takeProfitPct)),
      };
    },
  };
}
