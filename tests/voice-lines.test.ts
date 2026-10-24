import { describe, expect, it } from "vitest";
import { briefing } from "@/lib/briefings";
import { allClips, clipKey, fnv, wingmanLines } from "@/lib/voice-lines";

describe("voice lines", () => {
  it("hashes stably", () => {
    expect(fnv("JC-316 voice channel online, pilot.")).toBe(fnv("JC-316 voice channel online, pilot."));
    expect(fnv("a")).not.toBe(fnv("b"));
  });

  it("pre-records every line a wingman briefing can say", () => {
    const keys = new Set(allClips().map((c) => clipKey(c.who, c.text)));
    const cases = [
      ["position", { unit: "sma_cross", symbol: "NVDA" }],
      ["trade", { unit: "rsi_revert", symbol: "MSFT", pnlRaw: 5 }],
      ["debrief-hero", { unit: "rsi_revert", symbol: "SOL/USD", pnlRaw: -2 }],
      ["signal", { unit: "sma_cross", symbol: "ETH/USD", action: "hold" }],
      ["call", { unit: "rsi_revert", symbol: "AAPL", action: "buy" }],
      ["order", { unit: "sma_cross", symbol: "TSLA", side: "sell" }],
      ["unit", { unit: "rsi_revert" }],
      ["win-rate", { unit: "sma_cross", value: "50%" }],
    ] as const;
    for (const [id, ctx] of cases) {
      const b = briefing(id, ctx)!;
      expect(keys.has(clipKey(b.speaker, b.quote!)), `${id} ${b.quote}`).toBe(true);
    }
  });

  it("keeps the recording set small", () => {
    const n = wingmanLines().length;
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(150);
    const chars = allClips().reduce((a, c) => a + c.text.length, 0);
    expect(chars).toBeLessThan(12_000);
  });
});
