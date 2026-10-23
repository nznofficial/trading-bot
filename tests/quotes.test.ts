import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/alpaca";
import { computeQuote } from "@/lib/quotes";

const bar = (t: string, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 1 });

describe("computeQuote", () => {
  it("measures stocks against the previous session's close", () => {
    const bars = [
      bar("2026-10-21T19:45:00Z", 99), // Oct 21 15:45 ET: final bar of the prior session
      bar("2026-10-22T13:30:00Z", 101),
      bar("2026-10-22T19:45:00Z", 104.5),
    ];
    const q = computeQuote("AAPL", "us_equity", bars, new Date("2026-10-22T20:00:00Z"))!;
    expect(q).toMatchObject({ price: 104.5, change: 5.5 });
    expect(q.changePct).toBeCloseTo(0.05556, 4);
  });

  it("measures crypto against 24 hours ago", () => {
    const now = new Date("2026-10-23T06:00:00Z");
    const bars = [
      bar("2026-10-22T05:45:00Z", 80_000),
      bar("2026-10-22T06:00:00Z", 81_000), // exactly 24h ago
      bar("2026-10-22T06:15:00Z", 79_000),
      bar("2026-10-23T05:45:00Z", 82_620),
    ];
    const q = computeQuote("BTC/USD", "crypto", bars, now)!;
    expect(q.change).toBe(1_620);
    expect(q.changePct).toBeCloseTo(0.02, 6);
  });

  it("returns null without bars and falls back to the first bar without a reference", () => {
    expect(computeQuote("SPY", "us_equity", [], new Date())).toBeNull();
    const q = computeQuote("SOL/USD", "crypto", [bar("2026-10-23T05:00:00Z", 100), bar("2026-10-23T05:45:00Z", 110)], new Date("2026-10-23T06:00:00Z"))!;
    expect(q.change).toBe(10);
  });
});
