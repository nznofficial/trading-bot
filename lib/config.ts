/** Display name (header, tab title, launch intro, Discord alerts). */
export const APP_NAME = "Mobile Market Corps";
export const APP_SHORT = "MMC";

export type StrategyId = "sma_cross" | "rsi_revert";
export type AssetClass = "us_equity" | "crypto";

/** Each symbol is owned by exactly one strategy, so positions are never contested. */
export const STOCKS: Record<string, StrategyId> = {
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

/** Crypto pairs trade 24/7. Symbols use Alpaca's order form ("BTC/USD"). */
export const CRYPTO: Record<string, StrategyId> = {
  "BTC/USD": "sma_cross",
  "ETH/USD": "sma_cross",
  "SOL/USD": "rsi_revert",
};

export const UNIVERSE: Record<string, StrategyId> = { ...STOCKS, ...CRYPTO };
export const STOCK_SYMBOLS = Object.keys(STOCKS);
export const CRYPTO_SYMBOLS = Object.keys(CRYPTO);

export const assetClassOf = (symbol: string): AssetClass => (symbol.includes("/") ? "crypto" : "us_equity");

const CRYPTO_BY_COMPACT = new Map(CRYPTO_SYMBOLS.map((s) => [s.replace("/", ""), s]));

/**
 * Alpaca reports crypto positions and fills as "BTCUSD" but takes orders as "BTC/USD".
 * Normalize everything to the slash form so trades, positions and orders line up.
 */
export function normalizeSymbol(symbol: string, assetClass?: string): string {
  if (symbol.includes("/")) return symbol;
  const known = CRYPTO_BY_COMPACT.get(symbol);
  if (known) return known;
  if (assetClass === "crypto" && symbol.endsWith("USD")) return `${symbol.slice(0, -3)}/USD`;
  return symbol;
}

export const BENCHMARKS: Record<AssetClass, string> = { us_equity: "SPY", crypto: "BTC/USD" };

export const BAR_TIMEFRAME = "15Min";
export const BAR_MINUTES = 15;
/** Calendar days of history to request; enough for ~200 regular-hours 15-min bars. */
export const BAR_LOOKBACK_DAYS = 21;
/** Crypto trades around the clock: 4 days ≈ 384 15-min bars. */
export const CRYPTO_BAR_LOOKBACK_DAYS = 4;

export const STRATEGY_PARAMS = {
  sma_cross: { fast: 20, slow: 50, crossLookback: 3 },
  rsi_revert: { period: 14, entry: 30, exit: 55 },
} as const;

/** Limits shared by every asset class. */
export const PORTFOLIO_RISK = {
  maxOpenPositions: 8,
  /** Halt new entries when today's P&L falls to this fraction of yesterday's equity. */
  dailyLossHaltPct: -0.03,
  /** Keep a small buying-power buffer so orders aren't rejected on price drift. */
  buyingPowerBuffer: 0.95,
  /** After a stop-loss exit, don't re-enter that symbol for this long (prevents stop whipsaw). */
  reentryCooldownHours: 24,
};

export const RISK = {
  /** Max fraction of equity allocated to a single new position. */
  maxPositionPct: 0.1,
  /** Protective stop attached to every entry (OTO / bracket leg). */
  stopLossPct: 0.05,
  /** Take-profit leg; null = exit is left to the strategy. */
  takeProfitPct: null as number | null,
};

export const CRYPTO_RISK = {
  maxPositionPct: 0.05,
  /** Cap on total crypto market value as a fraction of equity. */
  maxClassPct: 0.3,
  /** Bot-managed stop-limit, re-checked every tick (Alpaca has no OTO for crypto). */
  stopLossPct: 0.05,
  /** Stop-limit's limit price sits this far below the stop so it still fills in a fast drop. */
  stopLimitSlippagePct: 0.01,
  /** Skip dust orders. */
  minNotional: 10,
};

/**
 * Crypto fee model for trade accounting. Alpaca takes ~0.25% (taker, lowest volume tier) on each side:
 * in-kind on buys (detected as a dust remainder) and in USD on sells (not reported by paper accounts,
 * so applied at this rate). Verified against a live paper round trip on 2026-10-23.
 */
export const CRYPTO_FEES = { cryptoSellFeeRate: 0.0025, dustFraction: 0.01 };

export const ALPACA_PAPER_URL = "https://paper-api.alpaca.markets";
export const ALPACA_DATA_URL = "https://data.alpaca.markets";
export const DATA_FEED = "iex";
