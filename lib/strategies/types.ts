import type { Bar } from "../alpaca";
import type { StrategyId } from "../config";

export type Action = "buy" | "sell" | "hold";

export type Signal = {
  action: Action;
  reason: string;
  indicators: Record<string, number | null>;
};

export type StrategyContext = {
  /** Completed bars, oldest first. */
  bars: Bar[];
  /** Shares currently held (0 if flat). */
  positionQty: number;
};

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
  minBars: number;
  evaluate(ctx: StrategyContext): Signal;
}
