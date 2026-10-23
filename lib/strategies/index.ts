import { UNIVERSE, type StrategyId } from "../config";
import { rsiRevert } from "./rsi-revert";
import { smaCross } from "./sma-cross";
import type { Strategy } from "./types";

export const STRATEGIES: Record<StrategyId, Strategy> = {
  sma_cross: smaCross,
  rsi_revert: rsiRevert,
};

export function strategyFor(symbol: string): Strategy | undefined {
  const id = UNIVERSE[symbol];
  return id ? STRATEGIES[id] : undefined;
}

export type { Strategy, Signal, Action } from "./types";
