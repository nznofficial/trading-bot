export type StrategyId = "sma_cross" | "rsi_revert";

/** Each symbol is owned by exactly one strategy, so positions are never contested. */
export const UNIVERSE: Record<string, StrategyId> = {
  SPY: "rsi_revert",
  QQQ: "rsi_revert",
  AAPL: "rsi_revert",
  MSFT: "rsi_revert",
  GOOGL: "rsi_revert",
  NVDA: "sma_cross",
  AMZN: "sma_cross",
  META: "sma_cross",
  TSLA: "sma_cross",
  AMD: "sma_cross",
};

export const SYMBOLS = Object.keys(UNIVERSE);

export const BENCHMARK = "SPY";

export const BAR_TIMEFRAME = "15Min";
export const BAR_MINUTES = 15;
/** Calendar days of history to request; enough for ~200 regular-hours 15-min bars. */
export const BAR_LOOKBACK_DAYS = 21;

export const STRATEGY_PARAMS = {
  sma_cross: { fast: 20, slow: 50, crossLookback: 3 },
  rsi_revert: { period: 14, entry: 30, exit: 55 },
} as const;

export const RISK = {
  /** Max fraction of equity allocated to a single new position. */
  maxPositionPct: 0.1,
  maxOpenPositions: 8,
  /** Halt new entries when today's P&L falls to this fraction of yesterday's equity. */
  dailyLossHaltPct: -0.03,
  /** Protective stop attached to every entry (OTO / bracket leg). */
  stopLossPct: 0.05,
  /** Take-profit leg; null = exit is left to the strategy. */
  takeProfitPct: null as number | null,
  /** Keep a small buying-power buffer so orders aren't rejected on price drift. */
  buyingPowerBuffer: 0.95,
};

export const ALPACA_PAPER_URL = "https://paper-api.alpaca.markets";
export const ALPACA_DATA_URL = "https://data.alpaca.markets";
export const DATA_FEED = "iex";
