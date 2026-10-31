import { describe, expect, it } from "vitest";
import { formatQty } from "@/lib/alpaca";
import { assetClassOf, normalizeSymbol } from "@/lib/config";
import { feeRow, feeUsd, isRegularSessionBar, makeClientOrderId, strategyFromClientOrderId } from "@/lib/engine";

describe("client order ids", () => {
  it("round-trips the strategy and is deterministic per bar", () => {
    const id = makeClientOrderId("sma_cross", "buy", "NVDA", "2026-10-22T15:30:00Z");
    expect(id).toBe("sma_cross.buy.NVDA.202610221530");
    expect(strategyFromClientOrderId(id)).toBe("sma_cross");
    expect(strategyFromClientOrderId("random-uuid")).toBeNull();
  });

  it("strips the slash from crypto pairs", () => {
    const id = makeClientOrderId("rsi_revert", "stop", "SOL/USD", "2026-10-23T05:30:00Z");
    expect(id).toBe("rsi_revert.stop.SOLUSD.202610230530");
    expect(strategyFromClientOrderId(id)).toBe("rsi_revert");
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

describe("crypto symbols", () => {
  it("normalizes Alpaca's compact form to the order form", () => {
    expect(normalizeSymbol("BTCUSD")).toBe("BTC/USD");
    expect(normalizeSymbol("BTC/USD")).toBe("BTC/USD");
    expect(normalizeSymbol("AAPL")).toBe("AAPL");
    // Unknown pairs are recognized by asset class.
    expect(normalizeSymbol("DOGEUSD", "crypto")).toBe("DOGE/USD");
    expect(normalizeSymbol("DOGEUSD")).toBe("DOGEUSD");
  });

  it("classifies by symbol", () => {
    expect(assetClassOf("ETH/USD")).toBe("crypto");
    expect(assetClassOf("SPY")).toBe("us_equity");
  });

  it("formats fractional quantities without float noise", () => {
    expect(formatQty(5)).toBe("5");
    expect(formatQty(0.1 + 0.2)).toBe("0.3");
    expect(formatQty(0.0625)).toBe("0.0625");
    expect(formatQty(0.000012307)).toBe("0.000012307");
  });

  it("values crypto fees in USD", () => {
    expect(feeUsd({ qty: "-0.00001", price: "80000", net_amount: undefined })).toBeCloseTo(0.8);
    expect(feeUsd({ qty: "-0.00001", price: "80000", net_amount: "-0.75" })).toBe(0.75);
  });
});

describe("feeRow", () => {
  it("files USD sell fees (no symbol, no order id) under USD", () => {
    const r = feeRow({
      id: "x",
      activity_type: "CFEE",
      date: "2026-10-29",
      created_at: "2026-10-29T13:30:21.752458Z",
      net_amount: "-0.64",
    });
    expect(r).toMatchObject({ symbol: "USD", assetClass: "crypto", orderId: null, amountUsd: 0.64 });
    expect(r.ts?.toISOString()).toBe("2026-10-29T13:30:21.752Z");
  });

  it("keeps in-kind buy fees on their coin", () => {
    const r = feeRow({ id: "y", activity_type: "CFEE", symbol: "BTCUSD", qty: "-0.00001", price: "80000", order_id: "o1" });
    expect(r).toMatchObject({ symbol: "BTC/USD", orderId: "o1" });
    expect(r.amountUsd).toBeCloseTo(0.8);
  });
});

describe("strategyFromClientOrderId", () => {
  it("attributes Herald orders", () => {
    expect(strategyFromClientOrderId("news_drift.buy.JPM.202610301400")).toBe("news_drift");
  });
});
