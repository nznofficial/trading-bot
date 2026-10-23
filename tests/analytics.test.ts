import { describe, expect, it } from "vitest";
import {
  aggregateFills,
  dailyCloses,
  downsample,
  drawdowns,
  matchRoundTrips,
  pctReturns,
  sharpe,
  sortino,
  tradeStats,
  tradingDay,
} from "@/lib/analytics";
import { CRYPTO_FEES } from "@/lib/config";

const t = (s: string) => new Date(s);

describe("aggregateFills + matchRoundTrips", () => {
  const strategies = new Map([
    ["b1", "rsi_revert"],
    ["b2", "rsi_revert"],
  ]);
  const fills = [
    { orderId: "b1", symbol: "AAPL", side: "buy", qty: 6, price: 100, ts: t("2026-10-01T14:00:00Z") },
    { orderId: "b1", symbol: "AAPL", side: "buy", qty: 4, price: 105, ts: t("2026-10-01T14:00:01Z") },
    { orderId: "b2", symbol: "AAPL", side: "buy", qty: 10, price: 110, ts: t("2026-10-02T14:00:00Z") },
    { orderId: "s1", symbol: "AAPL", side: "sell", qty: 15, price: 120, ts: t("2026-10-03T14:00:00Z") },
  ];

  it("collapses partial fills into one VWAP execution per order", () => {
    const ex = aggregateFills(fills, strategies);
    expect(ex).toHaveLength(3);
    expect(ex[0]).toMatchObject({ orderId: "b1", qty: 10, price: 102, strategy: "rsi_revert" });
    expect(ex[2].strategy).toBe("manual");
  });

  it("matches sells FIFO and leaves the remainder open", () => {
    const { trades, openLots } = matchRoundTrips(aggregateFills(fills, strategies));
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ qty: 10, entryPrice: 102, exitPrice: 120, pnl: 180, strategy: "rsi_revert" });
    expect(trades[1]).toMatchObject({ qty: 5, entryPrice: 110, pnl: 50 });
    // Each round trip remembers the orders that opened and closed it (used for win alerts).
    expect(trades[0]).toMatchObject({ entryOrderId: "b1", exitOrderId: "s1" });
    expect(trades[1]).toMatchObject({ entryOrderId: "b2", exitOrderId: "s1" });
    expect(openLots).toEqual([expect.objectContaining({ symbol: "AAPL", qty: 5, price: 110 })]);
  });
});

describe("tradeStats", () => {
  const trade = (pnl: number) => ({ pnl, holdMs: 1000 }) as never;
  it("computes win rate, profit factor and expectancy", () => {
    const s = tradeStats([trade(100), trade(50), trade(-30), trade(-20)]);
    expect(s).toMatchObject({ count: 4, wins: 2, winRate: 0.5, avgWin: 75, avgLoss: -25, profitFactor: 3, expectancy: 25, totalPnl: 100 });
  });
  it("handles no trades", () => {
    expect(tradeStats([])).toMatchObject({ count: 0, winRate: null, profitFactor: null });
  });
});

describe("equity analytics", () => {
  it("buckets by New York trading day", () => {
    // 01:00 UTC on Oct 2 is still Oct 1 in New York.
    expect(tradingDay(t("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
    const daily = dailyCloses([
      { ts: t("2026-10-01T14:00:00Z"), equity: 100 },
      { ts: t("2026-10-01T19:45:00Z"), equity: 101 },
      { ts: t("2026-10-02T14:00:00Z"), equity: 99 },
    ]);
    expect(daily).toEqual([
      { date: "2026-10-01", equity: 101 },
      { date: "2026-10-02", equity: 99 },
    ]);
  });

  it("computes drawdown from the running peak", () => {
    const pts = [100, 120, 90, 110, 130].map((equity, i) => ({ ts: new Date(i), equity }));
    const { series, max } = drawdowns(pts);
    expect(max).toBeCloseTo(-0.25);
    expect(series.at(-1)!.dd).toBe(0);
  });

  it("returns null ratios with too little data and signs them correctly otherwise", () => {
    expect(sharpe([0.01])).toBeNull();
    const r = pctReturns([100, 101, 100.5, 102, 101.8, 103]);
    expect(sharpe(r)!).toBeGreaterThan(0);
    expect(sortino(r)!).toBeGreaterThan(sharpe(r)!);
  });
});

describe("downsample", () => {
  const H = 3_600_000;
  const now = Date.parse("2026-10-23T12:00:00Z");
  // 15-minute points over the last 10 days.
  const pts = Array.from({ length: 10 * 96 }, (_, i) => ({ ts: now - (10 * 96 - 1 - i) * 15 * 60_000, v: i }));

  it("keeps full detail recently and hourly closes before that", () => {
    const out = downsample(pts, now, 7, 90);
    const recent = out.filter((p) => p.ts >= now - 7 * 24 * H);
    const older = out.filter((p) => p.ts < now - 7 * 24 * H);
    expect(recent.length).toBe(pts.filter((p) => p.ts >= now - 7 * 24 * H).length);
    // ~3 days of hourly closes (plus the first point).
    expect(older.length).toBeGreaterThanOrEqual(3 * 24);
    expect(older.length).toBeLessThanOrEqual(3 * 24 + 2);
    expect(out[0]).toBe(pts[0]);
    expect(out.at(-1)).toBe(pts.at(-1));
  });

  it("drops to daily closes beyond the hourly window", () => {
    const out = downsample(pts, now, 1, 3);
    const daily = out.filter((p) => p.ts < now - 3 * 24 * H);
    // 7 days of data touch up to 8 New York calendar days, plus the always-kept first point.
    expect(daily.length).toBeLessThanOrEqual(9);
    expect(daily.length).toBeGreaterThanOrEqual(7);
  });

  it("leaves short series alone", () => {
    expect(downsample(pts.slice(-50), now)).toHaveLength(50);
  });
});

describe("crypto fee model (matches a live paper round trip, 2026-10-23)", () => {
  const fills = [
    // Buy for ~$10 filled in two pieces; Alpaca took a 0.25% fee in BTC, so we only received 0.000122156.
    { orderId: "buy", symbol: "BTC/USD", side: "buy", qty: 0.000122363, price: 81677.6, ts: t("2026-10-23T06:55:00Z") },
    { orderId: "buy", symbol: "BTC/USD", side: "buy", qty: 1e-7, price: 81666, ts: t("2026-10-23T06:55:01Z") },
    { orderId: "sell", symbol: "BTC/USD", side: "sell", qty: 0.000122156, price: 81648.12, ts: t("2026-10-23T07:10:00Z") },
  ];

  it("folds the in-kind buy fee into the trade and charges the USD sell fee", () => {
    const { trades, openLots } = matchRoundTrips(aggregateFills(fills, new Map()), CRYPTO_FEES);
    expect(openLots).toHaveLength(0); // no phantom sliver left open
    expect(trades).toHaveLength(1);
    const tr = trades[0];
    expect(tr.fees).toBeCloseTo(0.0499, 3); // ≈ $0.025 in-kind + ≈ $0.025 USD
    // Cash actually fell $0.06 (Alpaca rounds to cents); the model lands within a cent.
    expect(tr.pnl).toBeCloseTo(-0.0535, 3);
    expect(tr.pnl).toBeGreaterThan(-0.065);
  });

  it("charges nothing on stocks and leaves real remainders open", () => {
    const stock = [
      { orderId: "b", symbol: "AAPL", side: "buy", qty: 10, price: 100, ts: t("2026-10-23T14:00:00Z") },
      { orderId: "s", symbol: "AAPL", side: "sell", qty: 9.95, price: 110, ts: t("2026-10-23T15:00:00Z") },
    ];
    const { trades, openLots } = matchRoundTrips(aggregateFills(stock, new Map()), CRYPTO_FEES);
    expect(trades[0]).toMatchObject({ fees: 0 });
    expect(openLots[0].qty).toBeCloseTo(0.05);
  });
});
