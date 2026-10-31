/** Display name (header, tab title, launch intro, Discord alerts). */
export const APP_NAME = "Mobile Market Corps";
export const APP_SHORT = "MMC";

export type StrategyId = "sma_cross" | "rsi_revert";
export type AssetClass = "us_equity" | "crypto";

/**
 * UNIT-00 Bastion, the core: holds SPY with a fixed share of equity while SPY's last daily close is above
 * its 200-day average, and sits in cash when it isn't. Vanguard and Recoil trade in what's left.
 * Defaults only; the share and on/off switch are live-tunable (Hangar → Tune units).
 */
export const CORE = {
  id: "spy_core",
  symbol: "SPY",
  smaDays: 200,
  /** Calendar days of daily bars to request: ~275 trading days, comfortably over the 200 needed. */
  lookbackDays: 400,
  pct: 0.7,
} as const;
export type CoreId = typeof CORE.id;

/**
 * UNIT-03 Herald: trades on news, not indicators. Buys a large cap after a strongly positive, material
 * headline and holds for a few trading days (post-news drift), in its own slice of equity. Defaults only;
 * the thresholds and on/off switch are live-tunable (Hangar → Tune units). Ships disarmed.
 */
export const HERALD = {
  id: "news_drift",
  pct: 0.1,
  entrySentiment: 0.6,
  minMateriality: 0.7,
  holdDays: 5,
  maxPositions: 3,
} as const;
export type HeraldId = typeof HERALD.id;
/** Anything that can own a position or an order. */
export type OwnerId = StrategyId | CoreId | HeraldId;

/** Each symbol is owned by exactly one strategy, so positions are never contested. */
export const STOCKS: Record<string, StrategyId> = {
  QQQ: "rsi_revert",
  AAPL: "rsi_revert",
  MSFT: "rsi_revert",
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

/**
 * Herald's targets, picked by rule rather than by hand so backtests carry no hindsight: the 40 largest
 * S&P 500 companies by market cap as of 2025-10-01 (the start of the 12-month backtest window), one share
 * class each, minus anything another unit already owns. Ranks near the bottom of the list are approximate.
 */
export const HERALD_STOCKS = [
  "GOOGL", "AVGO", "BRK.B", "ORCL", "JPM", "WMT", "LLY", "V", "MA", "NFLX",
  "XOM", "JNJ", "PLTR", "COST", "ABBV", "HD", "BAC", "PG", "UNH", "GE",
  "CVX", "KO", "CSCO", "IBM", "WFC", "TMUS", "MS", "PM", "GS", "CRM",
  "ABT", "AXP", "MU", "LIN", "MCD", "CAT", "RTX", "MRK", "PEP", "T",
] as const;

export const UNIVERSE: Record<string, StrategyId> = { ...STOCKS, ...CRYPTO };
/** Every symbol the bot trades and who owns it: the core's SPY, the TA units' universe, then Herald's list. */
export const OWNERS: Record<string, OwnerId> = {
  [CORE.symbol]: CORE.id,
  ...UNIVERSE,
  ...Object.fromEntries(HERALD_STOCKS.map((s) => [s, HERALD.id])),
};
export const STOCK_SYMBOLS = Object.keys(STOCKS);
export const CRYPTO_SYMBOLS = Object.keys(CRYPTO);

/**
 * News layer. Headlines come from Alpaca's news API; Claude scores each (article, tracked symbol) pair.
 * Gate defaults (live-tunable): a headline at or below `vetoSentiment` with at least `minMateriality`
 * blocks new unit buys in that symbol for `vetoHours` and lifts an open position's stop to
 * `tightenPct` below the price. Bastion's SPY is exempt.
 */
export const NEWS = {
  model: "claude-haiku-5-5",
  vetoSentiment: -0.6,
  minMateriality: 0.7,
  vetoHours: 24,
  tightenPct: 0.02,
  /** Most (article, symbol) pairs scored per tick; leftovers wait for the next tick. */
  scorePerTick: 120,
  /** Headlines per scoring request. */
  scoreBatch: 20,
  /** Articles tagged with more tracked symbols than this are roundups: only the first few get scored. */
  maxSymbolsPerArticle: 6,
  /** First sync looks back this far. */
  initialLookbackHours: 48,
} as const;

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

/** Saved simulator runs keep every daily point but only this many of the most recent trades. */
export const MAX_STORED_SIM_TRADES = 400;

export const ALPACA_PAPER_URL = "https://paper-api.alpaca.markets";
export const ALPACA_DATA_URL = "https://data.alpaca.markets";
export const DATA_FEED = "iex";
