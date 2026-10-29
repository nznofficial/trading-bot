import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_PARAMS } from "@/lib/live-params";
import { dailyUnitReturns, HEALTH, matchesLive, unitDrawdown, unitHealth, type HealthTrade } from "@/lib/health";
import { SimParams } from "@/lib/simulator";

const DAY = 86_400_000;
const T0 = Date.parse("2026-06-01T16:00:00Z");

/** One Vanguard stock trade closing `day` days after T0. */
const trade = (day: number, pnl: number, returnPct = pnl / 10_000): HealthTrade => ({
  strategy: "sma_cross",
  assetClass: "us_equity",
  entryTs: T0 + day * DAY - 3_600_000,
  exitTs: T0 + day * DAY,
  pnl,
  returnPct,
});

describe("unitDrawdown", () => {
  it("tracks the realized-P&L curve from its peak", () => {
    const dd = unitDrawdown([trade(1, 1000), trade(2, -2200), trade(3, 100)], 100_000);
    expect(dd.max).toBeCloseTo(98_800 / 101_000 - 1);
    expect(dd.current).toBeCloseTo(98_900 / 101_000 - 1);
  });

  it("is zero with no trades", () => {
    expect(unitDrawdown([], 100_000)).toEqual({ current: 0, max: 0 });
  });
});

describe("dailyUnitReturns", () => {
  it("fills days without exits with zero and sums same-day exits", () => {
    const r = dailyUnitReturns([trade(0, 500), trade(0, 500), trade(2, -1000)], 100_000, T0, T0 + 2 * DAY);
    expect(r).toEqual([0.01, 0, -0.01]);
  });
});

describe("unitHealth", () => {
  // A steady backtest: one +0.6% trade every 3 days, the occasional −0.4% loser.
  const baseline = {
    trades: Array.from({ length: 60 }, (_, i) => trade(i * 3, i % 4 === 3 ? -400 : 600)),
    base: 100_000,
    from: T0,
    to: T0 + 180 * DAY,
  };
  const live = (trades: HealthTrade[], days = 120) => ({ trades, base: 100_000, since: T0, now: T0 + days * DAY });

  it("is nominal when live matches the backtest", () => {
    const h = unitHealth({ live: live(baseline.trades.filter((t) => t.exitTs <= T0 + 120 * DAY)), baseline });
    expect(h.overall).toBe("ok");
    expect(h.expectancy.status).toBe("ok");
    expect(h.sharpe.status).toBe("ok");
  });

  it("flags a breach when recent trades lose money", () => {
    const losers = Array.from({ length: 30 }, (_, i) => trade(i * 3, -300));
    const h = unitHealth({ live: live(losers), baseline });
    expect(h.expectancy.status).toBe("alert");
    expect(h.sharpe.status).toBe("alert");
    expect(h.drawdown.status).toBe("alert");
    expect(h.overall).toBe("alert");
  });

  it("watches a drawdown past half the limit but not beyond it", () => {
    // This backtest's worst is shallow, so the 1% floor is the limit.
    const limit = Math.min(unitDrawdown(baseline.trades, 100_000).max, HEALTH.minDrawdownLimit);
    expect(limit).toBe(HEALTH.minDrawdownLimit);
    // Up 10k, then give back 60% of the limit from the 110k peak.
    const h = unitHealth({ live: live([trade(1, 10_000), trade(2, limit * 0.6 * 110_000)]), baseline });
    expect(h.drawdown.status).toBe("watch");
  });

  it("says too early with little history", () => {
    const h = unitHealth({ live: live([trade(1, 500), trade(2, 500)], 10), baseline });
    expect(h.sharpe.status).toBe("thin");
    expect(h.expectancy.status).toBe("thin");
    expect(h.sharpe.days).toBeLessThan(HEALTH.minSharpeDays);
    expect(h.drawdown.status).toBe("ok");
    expect(h.overall).toBe("thin");
  });

  it("only counts the rolling window", () => {
    // Old losers, then 30 days of steady winners: rolling expectancy uses the last 25 trades.
    const trades = [...Array.from({ length: 20 }, (_, i) => trade(i, -500)), ...Array.from({ length: 25 }, (_, i) => trade(40 + i, 800))];
    const h = unitHealth({ live: live(trades, 70), baseline });
    expect(h.expectancy.live).toBeCloseTo(0.08);
    expect(h.expectancy.status).toBe("ok");
  });
});

describe("matchesLive", () => {
  const params = SimParams.parse({});

  it("matches a run on the live tuning", () => {
    expect(matchesLive(params, DEFAULT_LIVE_PARAMS, "sma_cross", "all")).toBe(true);
  });

  it("rejects a run on different SMA settings or stop", () => {
    expect(matchesLive({ ...params, sma: { ...params.sma, slow: 60 } }, DEFAULT_LIVE_PARAMS, "sma_cross", "all")).toBe(false);
    expect(matchesLive({ ...params, stopLossPct: 0.03 }, DEFAULT_LIVE_PARAMS, "sma_cross", "all")).toBe(false);
  });

  it("ignores the other unit's tuning", () => {
    expect(matchesLive({ ...params, rsi: { ...params.rsi, entry: 20 } }, DEFAULT_LIVE_PARAMS, "sma_cross", "all")).toBe(true);
  });

  it("matches Recoil on its RSI settings, not Vanguard's", () => {
    expect(matchesLive({ ...params, sma: { ...params.sma, slow: 60 } }, DEFAULT_LIVE_PARAMS, "rsi_revert", "all")).toBe(true);
    expect(matchesLive({ ...params, rsi: { ...params.rsi, entry: 20 } }, DEFAULT_LIVE_PARAMS, "rsi_revert", "all")).toBe(false);
  });

  it("requires the run to cover the theater being viewed", () => {
    expect(matchesLive({ ...params, theater: "crypto" }, DEFAULT_LIVE_PARAMS, "sma_cross", "us_equity")).toBe(false);
    expect(matchesLive({ ...params, theater: "all" }, DEFAULT_LIVE_PARAMS, "sma_cross", "us_equity")).toBe(true);
  });
});
