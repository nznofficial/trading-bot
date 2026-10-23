import { assetClassOf, type AssetClass } from "./config";

export type FillRow = {
  orderId: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  ts: Date;
};

export type Execution = {
  orderId: string;
  symbol: string;
  assetClass: AssetClass;
  side: "buy" | "sell";
  qty: number;
  price: number;
  ts: Date;
  strategy: string;
};

export type RoundTrip = {
  symbol: string;
  assetClass: AssetClass;
  entryOrderId: string;
  exitOrderId: string;
  strategy: string;
  entryTs: Date;
  exitTs: Date;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
  holdMs: number;
};

export type OpenLot = {
  symbol: string;
  assetClass: AssetClass;
  orderId: string;
  strategy: string;
  qty: number;
  price: number;
  ts: Date;
};

const EPS = 1e-9;

/** Collapse partial fills into one execution per order (VWAP price, last fill time). */
export function aggregateFills(rows: FillRow[], strategyByOrder: Map<string, string>): Execution[] {
  const byOrder = new Map<string, Execution>();
  const notional = new Map<string, number>();
  for (const f of rows) {
    if (f.side !== "buy" && f.side !== "sell") continue; // long-only bot
    const value = (notional.get(f.orderId) ?? 0) + f.qty * f.price;
    notional.set(f.orderId, value);
    const e = byOrder.get(f.orderId);
    if (e) {
      e.qty += f.qty;
      e.price = value / e.qty;
      if (f.ts > e.ts) e.ts = f.ts;
    } else {
      byOrder.set(f.orderId, {
        orderId: f.orderId,
        symbol: f.symbol,
        assetClass: assetClassOf(f.symbol),
        side: f.side,
        qty: f.qty,
        price: f.price,
        ts: f.ts,
        strategy: strategyByOrder.get(f.orderId) ?? "manual",
      });
    }
  }
  return [...byOrder.values()].sort((a, b) => a.ts.getTime() - b.ts.getTime());
}

/** FIFO-match sells against earlier buys. The entry lot's strategy owns the round trip. */
export function matchRoundTrips(execs: Execution[]): { trades: RoundTrip[]; openLots: OpenLot[] } {
  const lots = new Map<string, OpenLot[]>();
  const trades: RoundTrip[] = [];
  for (const e of execs) {
    const queue = lots.get(e.symbol) ?? [];
    lots.set(e.symbol, queue);
    if (e.side === "buy") {
      queue.push({
        symbol: e.symbol,
        assetClass: e.assetClass,
        orderId: e.orderId,
        strategy: e.strategy,
        qty: e.qty,
        price: e.price,
        ts: e.ts,
      });
      continue;
    }
    let remaining = e.qty;
    while (remaining > EPS && queue.length) {
      const lot = queue[0];
      const q = Math.min(lot.qty, remaining);
      const pnl = (e.price - lot.price) * q;
      trades.push({
        symbol: e.symbol,
        assetClass: e.assetClass,
        entryOrderId: lot.orderId,
        exitOrderId: e.orderId,
        strategy: lot.strategy,
        entryTs: lot.ts,
        exitTs: e.ts,
        qty: q,
        entryPrice: lot.price,
        exitPrice: e.price,
        pnl,
        returnPct: (e.price - lot.price) / lot.price,
        holdMs: e.ts.getTime() - lot.ts.getTime(),
      });
      lot.qty -= q;
      remaining -= q;
      if (lot.qty <= EPS) queue.shift();
    }
  }
  return { trades, openLots: [...lots.values()].flat() };
}

export type TradeStats = {
  count: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  totalPnl: number;
  avgHoldMs: number | null;
};

export function tradeStats(trades: RoundTrip[]): TradeStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const sum = (xs: RoundTrip[]) => xs.reduce((a, t) => a + t.pnl, 0);
  const grossWin = sum(wins);
  const grossLoss = -sum(losses);
  const n = trades.length;
  return {
    count: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : null,
    expectancy: n ? (grossWin - grossLoss) / n : null,
    totalPnl: grossWin - grossLoss,
    avgHoldMs: n ? trades.reduce((a, t) => a + t.holdMs, 0) / n : null,
  };
}

const nyDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in New York time (the trading day). */
export const tradingDay = (d: Date) => nyDate.format(d);

export type EquityPoint = { ts: Date; equity: number };

/** Last equity value of each trading day. Input must be sorted by ts. */
export function dailyCloses(points: EquityPoint[]): { date: string; equity: number }[] {
  const out = new Map<string, number>();
  for (const p of points) out.set(tradingDay(p.ts), p.equity);
  return [...out].map(([date, equity]) => ({ date, equity }));
}

export function pctReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] > 0) out.push(values[i] / values[i - 1] - 1);
  }
  return out;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Periods per year for annualizing daily returns. The bot snapshots equity every day of the week
 * (crypto trades on weekends), so returns are calendar-daily, not trading-daily.
 */
export const PERIODS_PER_YEAR = 365;

/** Annualized Sharpe of daily returns (risk-free rate ≈ 0). Needs ≥ 2 returns. */
export function sharpe(daily: number[]): number | null {
  if (daily.length < 2) return null;
  const m = mean(daily);
  const sd = Math.sqrt(daily.reduce((a, r) => a + (r - m) ** 2, 0) / (daily.length - 1));
  return sd > 0 ? (m / sd) * Math.sqrt(PERIODS_PER_YEAR) : null;
}

/** Annualized Sortino: penalizes only downside deviation. */
export function sortino(daily: number[]): number | null {
  if (daily.length < 2) return null;
  const m = mean(daily);
  const dd = Math.sqrt(daily.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / daily.length);
  return dd > 0 ? (m / dd) * Math.sqrt(PERIODS_PER_YEAR) : null;
}

/** Drawdown from running peak at each point (≤ 0), plus the maximum drawdown. */
export function drawdowns(points: EquityPoint[]): { series: { ts: Date; dd: number }[]; max: number } {
  let peak = -Infinity;
  let max = 0;
  const series = points.map((p) => {
    peak = Math.max(peak, p.equity);
    const dd = peak > 0 ? p.equity / peak - 1 : 0;
    max = Math.min(max, dd);
    return { ts: p.ts, dd };
  });
  return { series, max };
}

/**
 * Thin a time series for charting: full detail for the last `fullDays`, then the last point per
 * hour, then the last point per day beyond `hourlyDays`. Always keeps the first and last points.
 * Compute metrics on the raw series; this is only for drawing.
 */
export function downsample<T extends { ts: number }>(points: T[], now: number, fullDays = 7, hourlyDays = 90): T[] {
  const fullFrom = now - fullDays * 86_400_000;
  const hourlyFrom = now - hourlyDays * 86_400_000;
  const bucket = (ts: number) =>
    ts >= fullFrom ? `t${ts}` : ts >= hourlyFrom ? `h${Math.floor(ts / 3_600_000)}` : `d${tradingDay(new Date(ts))}`;
  // Keep a point when it's the last of its bucket (its "close"), plus the very first point.
  return points.filter((p, i) => i === 0 || i === points.length - 1 || bucket(p.ts) !== bucket(points[i + 1].ts));
}
