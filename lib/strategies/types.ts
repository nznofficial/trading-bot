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

/** Signal at bar index `i` given the current position. Indicators are precomputed once. */
export type Evaluator = (i: number, positionQty: number) => Signal;

export interface Strategy {
  id: StrategyId;
  name: string;
  description: string;
  minBars: number;
  /** Precompute indicator series over `bars`; returns a cheap per-bar evaluator (used by the simulator). */
  prepare(bars: Bar[]): Evaluator;
  /** Signal on the latest bar (used live). Same logic as `prepare(bars)(bars.length - 1, qty)`. */
  evaluate(ctx: StrategyContext): Signal;
}
