import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/alpaca";
import { runBacktest, type BacktestConfig } from "@/lib/backtest";
import type { Strategy } from "@/lib/strategies/types";

const cfg: BacktestConfig = {
  startEquity: 100_000,
  stocks: { maxPositionPct: 0.1, stopLossPct: 0.05 },
  crypto: { maxPositionPct: 0.05, maxClassPct: 0.3, stopLossPct: 0.05, feeRate: 0.0025 },
  maxOpenPositions: 8,
  dailyLossHaltPct: -0.03,
  cooldownHours: 24,
};

const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({
  t: new Date(Date.parse("2026-01-05T15:00:00Z") + i * 15 * 60_000).toISOString(),
  o,
  h,
  l,
  c,
  v: 1,
});

/** Scripted strategy: buy at the given bar indexes, sell at others. */
function scripted(buyAt: number[], sellAt: number[] = []): Strategy {
  return {
    id: "sma_cross",
    name: "scripted",
    description: "",
    minBars: 1,
    prepare: () => (i, qty) =>
      qty === 0 && buyAt.includes(i)
        ? { action: "buy", reason: "test", indicators: {} }
        : qty > 0 && sellAt.includes(i)
          ? { action: "sell", reason: "test", indicators: {} }
          : { action: "hold", reason: "", indicators: {} },
    evaluate: () => ({ action: "hold", reason: "", indicators: {} }),
  };
}

describe("runBacktest", () => {
  it("fills at the next bar's open, not the signal bar's close (no look-ahead)", () => {
    const bars = { AAPL: [bar(0, 100, 101, 99, 100), bar(1, 105, 106, 104, 105), bar(2, 110, 111, 109, 110), bar(3, 120, 121, 119, 120)] };
    const r = runBacktest(bars, { AAPL: scripted([0], [2]) }, cfg);
    expect(r.trades).toHaveLength(1);
    // Signal on bar 0's close → buy at bar 1 open (105); sell signal on bar 2 → sell at bar 3 open (120).
    expect(r.trades[0]).toMatchObject({ entryPrice: 105, exitPrice: 120, exitReason: "signal", qty: 95 });
    expect(r.trades[0].pnl).toBeCloseTo(95 * 15);
  });

  it("stops out on the bar's low, filling at the open when it gaps through", () => {
    const bars = {
      AAPL: [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 98, 99, 94, 95), bar(3, 90, 91, 85, 86)],
    };
    const r = runBacktest(bars, { AAPL: scripted([0]) }, cfg);
    expect(r.trades[0]).toMatchObject({ exitReason: "stop", exitPrice: 95 }); // stop = 100 × 0.95
    const gap = runBacktest(
      { AAPL: [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 90, 91, 88, 89)] },
      { AAPL: scripted([0]) },
      cfg,
    );
    expect(gap.trades[0]).toMatchObject({ exitReason: "stop", exitPrice: 90 }); // gapped below 95 → open
  });

  it("respects the re-entry cooldown after a stop", () => {
    const series = [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 100, 100, 90, 92), bar(3, 92, 93, 91, 92), bar(4, 92, 93, 91, 92)];
    const r = runBacktest({ AAPL: series }, { AAPL: scripted([0, 2, 3]) }, cfg);
    expect(r.trades).toHaveLength(1); // stopped on bar 2; re-buy signals within 24h are ignored
    expect(r.trades[0].exitReason).toBe("stop");
  });

  it("charges crypto fees on both sides and caps crypto size", () => {
    const bars = { "BTC/USD": [bar(0, 80_000, 80_000, 80_000, 80_000), bar(1, 80_000, 80_000, 80_000, 80_000), bar(2, 80_000, 80_000, 80_000, 80_000), bar(3, 80_000, 80_000, 80_000, 80_000)] };
    const r = runBacktest(bars, { "BTC/USD": scripted([0], [2]) }, cfg);
    const tr = r.trades[0];
    expect(tr.qty * 80_000).toBeCloseTo(5_000 * 0.9975, 0); // 5% position, 0.25% taken in-kind
    expect(tr.fees).toBeCloseTo(5_000 * 0.0025 + 5_000 * 0.9975 * 0.0025, 1);
    expect(tr.pnl).toBeCloseTo(-tr.fees, 1); // flat price → loss equals fees
    expect(r.summary.endEquity).toBeCloseTo(100_000 - tr.fees, 1);
  });

  it("closes open positions at the end and reports summary stats", () => {
    const bars = { AAPL: [bar(0, 100, 100, 100, 100), bar(1, 100, 100, 100, 100), bar(2, 110, 110, 110, 110)] };
    const r = runBacktest(bars, { AAPL: scripted([0]) }, cfg);
    expect(r.trades[0].exitReason).toBe("end");
    expect(r.summary.totalReturn).toBeCloseTo((100 * 10) / 100_000);
    expect(r.summary.count).toBe(1);
    expect(r.equity.at(-1)!.equity).toBeCloseTo(101_000);
  });
});
