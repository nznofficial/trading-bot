import { describe, expect, it } from "vitest";
import { COPILOT_STATES, copilotLine, copilotReport, copilotState, type CopilotInput } from "@/lib/copilot";

const base: CopilotInput = {
  page: "/",
  paused: false,
  marketOpen: true,
  nextOpenIn: null,
  lastRun: { id: 7, status: "ok", error: null },
  dayPnl: 133.38,
  dayPnlPct: 0.0013,
  currentDrawdown: 0,
  equity: 100_133.38,
  streak: 0,
  positions: [
    { symbol: "MSFT", unrealizedPl: 148.63, strategy: "rsi_revert" },
    { symbol: "GOOGL", unrealizedPl: -15.19, strategy: "rsi_revert" },
  ],
  bigWin: null,
};

describe("copilotState priority", () => {
  it("is active while trading normally", () => expect(copilotState(base)).toBe("active"));
  it("an error beats everything", () =>
    expect(copilotState({ ...base, page: "/simulator", bigWin: { symbol: "X", pnl: 1, returnPct: 0.03, strategy: "sma_cross" }, lastRun: { id: 1, status: "error", error: "boom" } })).toBe("alert"));
  it("the simulator page thinks, even when the market is closed", () =>
    expect(copilotState({ ...base, page: "/simulator", marketOpen: false, positions: [] })).toBe("thinking"));
  it("a big win beats damage", () =>
    expect(copilotState({ ...base, dayPnlPct: -0.02, bigWin: { symbol: "NVDA", pnl: 300, returnPct: 0.031, strategy: "sma_cross" } })).toBe("victory"));
  it("damaged on a -1% day or -5% drawdown", () => {
    expect(copilotState({ ...base, dayPnlPct: -0.01 })).toBe("damaged");
    expect(copilotState({ ...base, currentDrawdown: -0.05 })).toBe("damaged");
    expect(copilotState({ ...base, dayPnlPct: -0.009, currentDrawdown: -0.049 })).toBe("active");
  });
  it("standby when paused, or closed with nothing open", () => {
    expect(copilotState({ ...base, paused: true })).toBe("standby");
    expect(copilotState({ ...base, marketOpen: false, positions: [] })).toBe("standby");
    expect(copilotState({ ...base, marketOpen: false })).toBe("active"); // holding overnight
  });
});

describe("copilot lines", () => {
  it("report the real numbers it was given, formatted", () => {
    const r = copilotReport({ ...base, lastRun: { id: 0, status: "ok", error: null } });
    expect(r).toEqual({ state: "active", line: "Recoil holding MSFT, +$148.63. Stops armed, pilot." });
  });
  it("rotate deterministically by sortie id", () => {
    const a = copilotLine("active", { ...base, lastRun: { id: 1, status: "ok", error: null } });
    const b = copilotLine("active", { ...base, lastRun: { id: 1, status: "ok", error: null } });
    const c = copilotLine("active", { ...base, lastRun: { id: 2, status: "ok", error: null } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("cover every state without throwing, for any rotation", () => {
    const rich: CopilotInput = {
      ...base,
      bigWin: { symbol: "NVDA", pnl: 312.5, returnPct: 0.031, strategy: "sma_cross" },
      lastRun: { id: 0, status: "error", error: "Alpaca 403 on /v2/orders" },
      nextOpenIn: "in 7h 12m",
      currentDrawdown: -0.062,
    };
    for (const state of COPILOT_STATES)
      for (let id = 0; id < 6; id++) {
        const line = copilotLine(state, { ...rich, lastRun: { ...rich.lastRun!, id } });
        expect(line.length).toBeGreaterThan(10);
        expect(line).not.toMatch(/undefined|NaN|null/);
      }
  });
  it("never breaks when a state is forced without its data (previews)", () => {
    for (let id = 0; id < 3; id++) {
      const line = copilotLine("victory", { ...base, bigWin: null, lastRun: { id, status: "ok", error: null } });
      expect(line).not.toMatch(/undefined|NaN/);
    }
  });

  it("describes damage with armor = 100% minus drawdown", () => {
    const line = copilotLine("damaged", { ...base, currentDrawdown: -0.062, lastRun: { id: 1, status: "ok", error: null } });
    expect(line).toBe("Armor integrity 93.8%, 6.2% off peak. We ride it out by the rules.");
  });
});
