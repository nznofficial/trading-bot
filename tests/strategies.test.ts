import { describe, expect, it } from "vitest";
import { rsiRevert } from "@/lib/strategies/rsi-revert";
import { smaCross } from "@/lib/strategies/sma-cross";
import { barsFrom, range } from "./helpers";

describe("sma_cross", () => {
  // Long decline then a sharp rally: SMA20 crosses above SMA50 near the end.
  const decline = range(80, (i) => 200 - i);
  const rally = (n: number) => range(n, (i) => 121 + i * 3);

  function firstCrossLen() {
    for (let n = 1; n < 60; n++) {
      const sig = smaCross.evaluate({ bars: barsFrom([...decline, ...rally(n)]), positionQty: 0 });
      if (sig.action === "buy") return n;
    }
    throw new Error("never crossed");
  }

  it("buys on a fresh crossover", () => {
    const n = firstCrossLen();
    const sig = smaCross.evaluate({ bars: barsFrom([...decline, ...rally(n)]), positionQty: 0 });
    expect(sig.action).toBe("buy");
    expect(sig.indicators.smaFast).toBeGreaterThan(sig.indicators.smaSlow!);
  });

  it("does not chase a stale crossover", () => {
    const sig = smaCross.evaluate({ bars: barsFrom([...decline, ...rally(firstCrossLen() + 10)]), positionQty: 0 });
    expect(sig.action).toBe("hold");
    expect(sig.reason).toMatch(/stale/);
  });

  it("sells a held position when the trend breaks", () => {
    const up = range(80, (i) => 100 + i);
    const crash = range(40, (i) => 179 - i * 3);
    expect(smaCross.evaluate({ bars: barsFrom([...up, ...crash]), positionQty: 10 }).action).toBe("sell");
    expect(smaCross.evaluate({ bars: barsFrom(up), positionQty: 10 }).action).toBe("hold");
  });

  it("holds while warming up", () => {
    expect(smaCross.evaluate({ bars: barsFrom(range(10, () => 100)), positionQty: 0 }).reason).toBe("warming up");
  });
});

describe("rsi_revert", () => {
  const selloff = range(30, (i) => 100 - i * 1.5);
  const bounce = range(30, (i) => 55 + i * 1.5);

  it("buys when oversold and flat", () => {
    expect(rsiRevert.evaluate({ bars: barsFrom(selloff), positionQty: 0 }).action).toBe("buy");
  });
  it("does not add to an existing position", () => {
    expect(rsiRevert.evaluate({ bars: barsFrom(selloff), positionQty: 5 }).action).toBe("hold");
  });
  it("sells once RSI recovers", () => {
    expect(rsiRevert.evaluate({ bars: barsFrom([...selloff, ...bounce]), positionQty: 5 }).action).toBe("sell");
  });
});
