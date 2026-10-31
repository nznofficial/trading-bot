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

describe("runBacktest with news", () => {
  const t0 = Date.parse("2026-01-05T15:00:00Z");
  const at = (i: number) => new Date(t0 + i * 15 * 60_000);
  const flat = (n: number, p = 100) => Array.from({ length: n }, (_, i) => bar(i, p, p, p, p));
  const gate = { enabled: true, vetoSentiment: -0.6, minMateriality: 0.7, vetoHours: 24, tightenPct: 0.02 };
  const head = (symbol: string, created: Date, sentiment: number, newsId = 1) => ({
    newsId,
    symbol,
    createdAt: created,
    sentiment,
    materiality: 0.9,
    headline: "h",
  });

  it("a veto published by the signal bar's close blocks the buy", () => {
    // Bar 0 closes at t0+15m; the headline lands at t0+10m.
    const r = runBacktest({ AAPL: flat(4) }, { AAPL: scripted([0]) }, {
      ...cfg,
      news: { headlines: [head("AAPL", new Date(t0 + 10 * 60_000), -0.9)], gate, herald: null },
    });
    expect(r.trades).toHaveLength(0);
    expect(r.news?.buysBlocked).toBe(1);
  });

  it("ignores a headline published after the bar closed (no look-ahead)", () => {
    const r = runBacktest({ AAPL: flat(4) }, { AAPL: scripted([0]) }, {
      ...cfg,
      news: { headlines: [head("AAPL", new Date(at(1).getTime() + 1), -0.9)], gate, herald: null },
    });
    expect(r.trades).toHaveLength(1);
  });

  it("lifts the stop of an open position once, never lowering it", () => {
    // Buy at bar 1 (stop 95). Veto by bar 2's close at 100 → stop 98; bar 3 dips to 97.
    const bars = { AAPL: [...flat(3), bar(3, 99, 99, 97, 98), bar(4, 98, 98, 98, 98)] };
    const r = runBacktest(bars, { AAPL: scripted([0]) }, {
      ...cfg,
      news: { headlines: [head("AAPL", at(2), -0.9)], gate, herald: null },
    });
    expect(r.news?.stopsLifted).toBe(1);
    expect(r.trades[0]).toMatchObject({ exitReason: "stop", exitPrice: 98 });
  });

  it("Herald buys a fresh positive headline in its own slice and exits after holdDays sessions", () => {
    // Three sessions of 26 bars each (bar timestamps step 15m; sessions split by trading day).
    const day = (d: number, n = 26) =>
      Array.from({ length: n }, (_, i) => ({
        t: new Date(Date.parse(`2026-01-0${5 + d}T14:30:00Z`) + i * 15 * 60_000).toISOString(),
        o: 50,
        h: 50,
        l: 50,
        c: 50,
        v: 1,
      }));
    const bars = { JPM: [...day(0), ...day(1), ...day(2)] };
    const herald = { enabled: true, pct: 0.1, maxPositions: 2, entrySentiment: 0.6, minMateriality: 0.7, holdDays: 2, symbols: ["JPM"] };
    const r = runBacktest(bars, {}, {
      ...cfg,
      news: { headlines: [head("JPM", new Date("2026-01-05T12:00:00Z"), 0.8)], gate: null, herald },
    });
    expect(r.trades).toHaveLength(1);
    // Budget = 10% / 2 positions of 100k = 5k at $50.
    expect(r.trades[0]).toMatchObject({ strategy: "news_drift", qty: 100, exitReason: "signal" });
    expect(r.trades[0].entryTs.toISOString()).toBe("2026-01-05T14:45:00.000Z");
    expect(r.trades[0].exitTs.toISOString().slice(0, 10)).toBe("2026-01-07");
  });
});
