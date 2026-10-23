import { describe, expect, it } from "vitest";
import { RISK } from "@/lib/config";
import { createRiskGate } from "@/lib/risk";

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
    const d = createRiskGate(base, { ...RISK, takeProfitPct: 0.1 }).approveEntry("AAPL", 100);
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

  it("halts entries after a 3% daily loss", () => {
    const gate = createRiskGate({ ...base, equity: 96_900 });
    expect(gate.approveEntry("A", 100)).toMatchObject({ ok: false });
    expect(createRiskGate({ ...base, equity: 97_100 }).approveEntry("A", 100).ok).toBe(true);
  });
});
