import { describe, expect, it } from "vitest";
import {
  aggregateFills,
  dailyCloses,
  drawdowns,
  matchRoundTrips,
  pctReturns,
  sharpe,
  sortino,
  tradeStats,
  tradingDay,
} from "@/lib/analytics";

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
