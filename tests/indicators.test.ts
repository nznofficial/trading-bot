import { describe, expect, it } from "vitest";
import { atr, ema, rsi, sma } from "@/lib/indicators";

describe("sma", () => {
  it("averages a sliding window with null warm-up", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("ema", () => {
  it("seeds with the SMA then smooths", () => {
    const out = ema([1, 2, 3, 4], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3, 10); // 4*0.5 + 2*0.5
  });
});

describe("rsi", () => {
  // Wilder's worked example (as published by StockCharts).
  const closes = [
    44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28,
    46.0, 46.03, 46.41, 46.22,
  ];
  it("matches the reference values", () => {
    const r = rsi(closes, 14);
    expect(r[13]).toBeNull();
    expect(r[14]).toBeCloseTo(70.46, 0);
    expect(r[15]).toBeCloseTo(66.25, 0);
    expect(r[17]).toBeCloseTo(69.41, 0);
  });
  it("is 100 for a straight rally and 0 for a straight decline", () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
  });
});

describe("atr", () => {
  it("equals the constant range when bars are uniform", () => {
    const n = 20;
    const close = Array(n).fill(10);
    const out = atr(close.map((c) => c + 1), close.map((c) => c - 1), close, 14);
    expect(out[14]).toBe(2);
    expect(out.at(-1)).toBe(2);
  });
});
