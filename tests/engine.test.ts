import { describe, expect, it } from "vitest";
import { isRegularSessionBar, makeClientOrderId, strategyFromClientOrderId } from "@/lib/engine";

describe("client order ids", () => {
  it("round-trips the strategy and is deterministic per bar", () => {
    const id = makeClientOrderId("sma_cross", "buy", "NVDA", "2026-10-22T15:30:00Z");
    expect(id).toBe("sma_cross.buy.NVDA.202610221530");
    expect(strategyFromClientOrderId(id)).toBe("sma_cross");
    expect(strategyFromClientOrderId("random-uuid")).toBeNull();
  });
});

describe("isRegularSessionBar", () => {
  it("keeps 09:30–15:45 ET bar starts only", () => {
    expect(isRegularSessionBar("2026-10-22T13:15:00Z")).toBe(false); // 09:15 ET
    expect(isRegularSessionBar("2026-10-22T13:30:00Z")).toBe(true); // 09:30 ET
    expect(isRegularSessionBar("2026-10-22T19:45:00Z")).toBe(true); // 15:45 ET
    expect(isRegularSessionBar("2026-10-22T20:00:00Z")).toBe(false); // 16:00 ET
    expect(isRegularSessionBar("2026-12-01T14:30:00Z")).toBe(true); // 09:30 EST
  });
});
