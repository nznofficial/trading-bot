import { describe, expect, it } from "vitest";
import { RISK } from "@/lib/config";
import { createRiskGate, DEFAULT_LIMITS, planCryptoStop } from "@/lib/risk";

const base = {
  equity: 100_000,
  lastEquity: 100_000,
  buyingPower: 200_000,
  heldSymbols: new Set<string>(),
  symbolsWithOpenOrders: new Set<string>(),
};

describe("risk gate", () => {
  it("sizes to 10% of equity in whole shares with a 5% stop", () => {
    const d = createRiskGate(base).approveEntry("AAPL", 230.37);
    expect(d).toEqual({ ok: true, qty: 43, stopLoss: 218.85, takeProfit: undefined });
  });

  it("adds a take-profit leg when configured", () => {
    const d = createRiskGate(base, { ...DEFAULT_LIMITS, stocks: { ...RISK, takeProfitPct: 0.1 } }).approveEntry("AAPL", 100);
    expect(d).toMatchObject({ ok: true, takeProfit: 110 });
  });

  it("rejects held symbols and symbols with open orders", () => {
    const gate = createRiskGate({ ...base, heldSymbols: new Set(["NVDA"]), symbolsWithOpenOrders: new Set(["AMD"]) });
    expect(gate.approveEntry("NVDA", 100)).toMatchObject({ ok: false, reason: "already holding" });
    expect(gate.approveEntry("AMD", 100)).toMatchObject({ ok: false, reason: "open order pending" });
  });

  it("caps open positions across entries in the same tick", () => {
    const held = new Set(["A", "B", "C", "D", "E", "F", "G"]);
    const gate = createRiskGate({ ...base, heldSymbols: held });
    expect(gate.approveEntry("X", 50).ok).toBe(true);
    expect(gate.approveEntry("Y", 50)).toMatchObject({ ok: false, reason: "max 8 positions" });
  });

  it("consumes buying power as entries are approved", () => {
    const gate = createRiskGate({ ...base, buyingPower: 15_000 });
    expect(gate.approveEntry("A", 100)).toMatchObject({ ok: true, qty: 100 });
    // 5,000 left × 0.95 buffer → 47 shares
    expect(gate.approveEntry("B", 100)).toMatchObject({ ok: true, qty: 47 });
    // 300 left × 0.95 = 285 → can't afford one 400 share
    expect(gate.approveEntry("C", 400)).toMatchObject({ ok: false, reason: "insufficient buying power" });
  });

  it("blocks re-entry during a stop-out cooldown", () => {
    const until = new Date("2026-10-24T15:00:00Z");
    const gate = createRiskGate({ ...base, cooldownUntil: new Map([["TSLA", until]]) });
    expect(gate.approveEntry("TSLA", 300)).toMatchObject({ ok: false, reason: expect.stringMatching(/^cooldown after stop-out until 2026-10-24T15:00Z/) });
    expect(gate.approveEntry("NVDA", 200).ok).toBe(true);
  });

  it("halts entries after a 3% daily loss", () => {
    const gate = createRiskGate({ ...base, equity: 96_900 });
    expect(gate.approveEntry("A", 100)).toMatchObject({ ok: false });
    expect(createRiskGate({ ...base, equity: 97_100 }).approveEntry("A", 100).ok).toBe(true);
  });
});

describe("risk gate: crypto", () => {
  const crypto = { ...base, nonMarginableBuyingPower: 100_000, cryptoExposure: 0 };

  it("sizes fractionally to 5% of equity with a bot-managed stop-limit", () => {
    const d = createRiskGate(crypto).approveEntry("BTC/USD", 80_000);
    expect(d).toEqual({ ok: true, qty: 0.0625, stopLoss: 76_000, stopLimit: 75_240 });
  });

  it("caps total crypto exposure at 30% of equity", () => {
    const gate = createRiskGate({ ...crypto, cryptoExposure: 27_000 });
    // Only $3,000 of class room left, below the 5% per-coin size.
    expect(gate.approveEntry("ETH/USD", 2_000)).toMatchObject({ ok: true, qty: 1.5 });
    expect(gate.approveEntry("SOL/USD", 150)).toMatchObject({ ok: false, reason: "crypto cap 30% reached" });
  });

  it("uses cash, not margin, for crypto", () => {
    const gate = createRiskGate({ ...crypto, buyingPower: 400_000, nonMarginableBuyingPower: 2_000 });
    expect(gate.approveEntry("BTC/USD", 80_000)).toMatchObject({ ok: true, qty: 0.02375 });
  });

  it("skips dust-sized orders", () => {
    const gate = createRiskGate({ ...crypto, nonMarginableBuyingPower: 5 });
    expect(gate.approveEntry("SOL/USD", 150)).toMatchObject({ ok: false, reason: "insufficient buying power" });
  });

  it("shares the position cap and cash with stocks", () => {
    const gate = createRiskGate({ ...crypto, nonMarginableBuyingPower: 12_000 });
    expect(gate.approveEntry("AAPL", 100)).toMatchObject({ ok: true, qty: 100 });
    // The stock buy used $10,000 of the cash: 2,000 × 0.95 = 1,900 left for crypto.
    expect(gate.approveEntry("ETH/USD", 1_000)).toMatchObject({ ok: true, qty: 1.9 });
  });
});

describe("planCryptoStop", () => {
  const pos = { qty: 0.5, avgEntry: 2_000, currentPrice: 2_050 };

  it("places a stop when none is resting", () => {
    expect(planCryptoStop(pos, [])).toEqual({ action: "place", stopPrice: 1_900, limitPrice: 1_881 });
  });

  it("keeps a stop that covers the position", () => {
    expect(planCryptoStop(pos, [{ id: "s1", type: "stop_limit", qty: 0.5 }])).toEqual({ action: "keep" });
  });

  it("resizes a stop that covers only part of the position", () => {
    expect(planCryptoStop(pos, [{ id: "s1", type: "stop_limit", qty: 0.2 }])).toMatchObject({
      action: "replace",
      cancelIds: ["s1"],
    });
  });

  it("ignores non-stop sell orders", () => {
    expect(planCryptoStop(pos, [{ id: "x", type: "limit", qty: 0.5 }])).toMatchObject({ action: "place" });
  });

  it("exits immediately when price is already through an unprotected stop", () => {
    expect(planCryptoStop({ ...pos, currentPrice: 1_850 }, [])).toMatchObject({ action: "exit" });
  });
});
