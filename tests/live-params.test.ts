import { describe, expect, it } from "vitest";
import { buildUnits, DEFAULT_LIVE_PARAMS, describeChanges, LiveParams } from "@/lib/live-params";

describe("live params", () => {
  it("defaults to the code settings and validates", () => {
    expect(LiveParams.safeParse(DEFAULT_LIVE_PARAMS).success).toBe(true);
    expect(LiveParams.safeParse({ ...DEFAULT_LIVE_PARAMS, sma: { fast: 50, slow: 20, crossLookback: 3 } }).success).toBe(false);
    expect(LiveParams.safeParse({ ...DEFAULT_LIVE_PARAMS, rsi: { period: 14, entry: 60, exit: 40 } }).success).toBe(false);
  });

  it("describes exactly what changed, for the Sorties log", () => {
    const after = { ...DEFAULT_LIVE_PARAMS, sma: { ...DEFAULT_LIVE_PARAMS.sma, slow: 200 }, cryptoEnabled: false };
    expect(describeChanges(DEFAULT_LIVE_PARAMS, after)).toEqual(["SMA slow 50 → 200", "crypto entries on → off"]);
    expect(describeChanges(DEFAULT_LIVE_PARAMS, DEFAULT_LIVE_PARAMS)).toEqual([]);
  });

  it("builds units with the tuned parameters", () => {
    const units = buildUnits({ ...DEFAULT_LIVE_PARAMS, sma: { fast: 10, slow: 30, crossLookback: 2 } });
    expect(units.sma_cross.name).toBe("SMA 10/30 Crossover");
    expect(units.sma_cross.minBars).toBe(32);
    expect(units.rsi_revert.name).toBe("RSI(14) Mean Reversion");
  });
});
