import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/alpaca";
import { runBacktest, type BacktestConfig } from "@/lib/backtest";
import { coreRegime, planCore, regimeByDate, type DailyClose } from "@/lib/core";
import { DEFAULT_LIVE_PARAMS, unitsMaxPct } from "@/lib/live-params";
import { createRiskGate, DEFAULT_LIMITS } from "@/lib/risk";
import type { Strategy } from "@/lib/strategies/types";

/** n weekdays-ish of closes starting 2026-01-01 (calendar days are fine: only order matters). */
const days = (closes: number[]): DailyClose[] =>
  closes.map((close, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), close }));

describe("coreRegime", () => {
  it("compares the last completed close with its average, ignoring today's bar", () => {
    const d = days([...Array(199).fill(100), 110, 50]); // day 201 (today) crashes but isn't complete
    const today = d[200].date;
    const r = coreRegime(d, today, 200);
    expect(r.asOf).toBe(d[199].date);
    expect(r.close).toBe(110);
    expect(r.sma).toBeCloseTo((199 * 100 + 110) / 200);
    expect(r.above).toBe(true);
  });

  it("is undecided without enough history", () => {
    expect(coreRegime(days(Array(50).fill(100)), "2027-01-01", 200).above).toBeNull();
  });

  it("agrees with the per-date lookup used by the backtest", () => {
    const d = days(Array.from({ length: 300 }, (_, i) => 100 + 10 * Math.sin(i / 15)));
    const lookup = regimeByDate(d, 200);
    for (const i of [200, 230, 260, 299]) expect(lookup(d[i].date)).toBe(coreRegime(d, d[i].date, 200).above);
    expect(lookup(d[100].date)).toBeNull();
  });
});

describe("planCore", () => {
  const base = { enabled: true, pct: 0.7, above: true, heldQty: 0, price: 500, equity: 100_000, spendable: 95_000, orderPending: false };

  it("buys the core share in whole shares when above the line and flat", () => {
    expect(planCore(base)).toMatchObject({ action: "buy", qty: 140 });
  });

  it("is limited by spendable cash", () => {
    expect(planCore({ ...base, spendable: 20_000 })).toMatchObject({ action: "buy", qty: 40 });
  });

  it("sells everything when SPY closes below the line, even if the core is safed", () => {
    expect(planCore({ ...base, above: false, heldQty: 140 })).toMatchObject({ action: "sell", qty: 140 });
    expect(planCore({ ...base, enabled: false, above: false, heldQty: 140 })).toMatchObject({ action: "sell", qty: 140 });
  });

  it("never rebalances or doubles up", () => {
    expect(planCore({ ...base, heldQty: 10 }).action).toBe("hold");
    expect(planCore({ ...base, orderPending: true }).action).toBe("hold");
  });

  it("doesn't buy when safed or undecided", () => {
    expect(planCore({ ...base, enabled: false }).action).toBe("hold");
    expect(planCore({ ...base, above: null }).action).toBe("hold");
  });
});

describe("units cap", () => {
  const state = { equity: 100_000, lastEquity: 100_000, buyingPower: 200_000, heldSymbols: new Set<string>(), symbolsWithOpenOrders: new Set<string>() };
  const limits = { ...DEFAULT_LIMITS, unitsMaxPct: unitsMaxPct(DEFAULT_LIVE_PARAMS) };

  it("defaults to 30% for the units when the core is armed, 100% when safed", () => {
    expect(unitsMaxPct(DEFAULT_LIVE_PARAMS)).toBeCloseTo(0.3);
    expect(unitsMaxPct({ ...DEFAULT_LIVE_PARAMS, core: { enabled: false, pct: 0.7 } })).toBe(1);
  });

  it("shrinks the last entry to fit and then blocks", () => {
    const gate = createRiskGate({ ...state, unitsExposure: 25_000 }, limits);
    expect(gate.approveEntry("AAPL", 100)).toMatchObject({ ok: true, qty: 50 }); // 5,000 room
    expect(gate.approveEntry("MSFT", 100)).toMatchObject({ ok: false, reason: "units cap 30% reached" });
  });

  it("applies to crypto too", () => {
    const gate = createRiskGate({ ...state, unitsExposure: 30_000 }, limits);
    expect(gate.approveEntry("BTC/USD", 60_000)).toMatchObject({ ok: false, reason: "units cap 30% reached" });
  });
});

describe("runBacktest with a core", () => {
  const cfg: BacktestConfig = {
    startEquity: 100_000,
    stocks: { maxPositionPct: 0.1, stopLossPct: 0.05 },
    crypto: { maxPositionPct: 0.05, maxClassPct: 0.3, stopLossPct: 0.05, feeRate: 0.0025 },
    maxOpenPositions: 8,
    dailyLossHaltPct: -0.03,
    cooldownHours: 24,
  };
  // Two trading days of 4 bars each; the regime is "above" on day 1 and "below" on day 2.
  const t = (day: number, i: number) => new Date(Date.parse(`2026-01-0${5 + day}T15:00:00Z`) + i * 15 * 60_000).toISOString();
  const spy: Bar[] = [0, 1].flatMap((d) => [0, 1, 2, 3].map((i) => ({ t: t(d, i), o: 100, h: 101, l: 99, c: 100, v: 1 })));
  const unitBars: Bar[] = spy.map((b) => ({ ...b }));
  const regime = (day: string) => day === "2026-01-05";
  const alwaysBuy: Strategy = {
    id: "sma_cross",
    name: "always",
    description: "",
    minBars: 1,
    prepare: () => () => ({ action: "buy", reason: "", indicators: {} }),
    evaluate: () => ({ action: "buy", reason: "", indicators: {} }),
  };

  it("buys the core on the next bar after an 'above' close and sells after 'below', with no stop", () => {
    const res = runBacktest({ SPY: spy }, {}, { ...cfg, regime, core: { id: "spy_core", symbol: "SPY", pct: 0.7 } });
    const core = res.trades.filter((x) => x.strategy === "spy_core");
    expect(core).toHaveLength(1);
    expect(core[0].qty).toBe(700);
    expect(core[0].entryTs.toISOString()).toBe(t(0, 1));
    expect(core[0].exitTs.toISOString()).toBe(t(1, 1));
    expect(core[0].exitReason).toBe("signal");
  });

  it("caps the units and blocks their buys while the filter is off", () => {
    const res = runBacktest(
      { SPY: spy, AAPL: unitBars },
      { AAPL: alwaysBuy },
      { ...cfg, regime: () => false, unitsMaxPct: 0.3, core: { id: "spy_core", symbol: "SPY", pct: 0.7 } },
    );
    expect(res.trades).toHaveLength(0);
    const capped = runBacktest({ AAPL: unitBars }, { AAPL: alwaysBuy }, { ...cfg, stocks: { maxPositionPct: 0.5, stopLossPct: 0.05 }, unitsMaxPct: 0.3 });
    expect(capped.trades[0].qty).toBe(300);
  });
});
