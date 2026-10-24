import { describe, expect, it } from "vitest";
import { BRIEFS, briefAttrs, briefing, positionBrief, tradeBrief, type BriefCtx } from "@/lib/briefings";

const CTX: BriefCtx = {
  scope: "Vanguard",
  value: "1.42",
  sub: "12 won, 8 lost",
  count: 20,
  days: 9,
  unit: "rsi_revert",
  symbol: "MSFT",
  status: "ok",
  trigger: "cron-job.org",
  action: "buy",
  acted: false,
};

describe("briefings", () => {
  it("renders every briefing with or without context, never leaking undefined/NaN/[object", () => {
    for (const id of Object.keys(BRIEFS)) {
      for (const ctx of [{}, CTX]) {
        const b = briefing(id, ctx)!;
        expect(b, id).not.toBeNull();
        for (const text of Object.values(b)) {
          expect(text.length, id).toBeGreaterThan(0);
          expect(text, id).not.toMatch(/undefined|NaN|\[object|null/);
        }
      }
    }
  });

  it("returns null for unknown ids, including prototype keys", () => {
    expect(briefing("nope")).toBeNull();
    expect(briefing("toString")).toBeNull();
  });

  it("quotes the panel's values verbatim", () => {
    const b = briefing("profit-factor", { scope: "Recoil", value: "1.85", count: 42 })!;
    expect(b.now).toBe("Recoil: 1.85.");
    expect(b.note).toContain("1.5");
  });

  it("warns when a sample is too small to judge", () => {
    expect(briefing("win-rate", { value: "75%", count: 4 })!.note).toContain("Only 4 closed trades");
    expect(briefing("win-rate", { value: "55%", count: 80 })!.note).not.toContain("Only");
  });

  it("explains each unit's exit rule on a position", () => {
    const attrs = positionBrief({
      symbol: "NVDA",
      strategy: "sma_cross",
      qty: 12,
      avgEntry: 120,
      currentPrice: 125.5,
      marketValue: 1506,
      unrealizedPl: 66,
      unrealizedPlpc: 0.0458,
    });
    const b = briefing(attrs["data-brief"], JSON.parse(attrs["data-brief-ctx"]))!;
    expect(b.title).toBe("Engagement · NVDA");
    expect(b.now).toBe("Vanguard holds 12 NVDA from $120.00, now $125.50, worth $1,506.00. Unrealized +$66.00 (+4.58%).");
    expect(b.note).toContain("fast moving average drops back below");
  });

  it("calls a losing trade a loss and a manual trade manual", () => {
    const attrs = tradeBrief({ symbol: "BTC/USD", strategy: null, entryPrice: 100, exitPrice: 99, pnl: -1.05, returnPct: -0.0105, holdMs: 3_600_000 });
    const b = briefing(attrs["data-brief"], JSON.parse(attrs["data-brief-ctx"]))!;
    expect(b.now).toMatch(/^Manual trade: BTC\/USD from \$100\.00 to \$99\.00: −\$1\.05/);
    expect(b.note).toMatch(/^A loss/);
  });

  it("flags the daily-loss halt on the equity panel", () => {
    expect(briefing("equity", { dayRaw: -0.031 })!.note).toContain("halt engaged");
    expect(briefing("equity", { dayRaw: -0.012 })!.note).toContain("new entries halt");
  });

  it("serializes context as JSON for the DOM", () => {
    expect(briefAttrs("armor", { value: "96.0%" })).toEqual({ "data-brief": "armor", "data-brief-ctx": '{"value":"96.0%"}' });
  });
});

describe("briefing readings", () => {
  it("says there's no reading instead of printing a dash", () => {
    expect(briefing("sharpe", { value: "—", sub: "1 day of history" })!.now).toBe("No reading yet · 1 day of history.");
    expect(briefing("sortino", { scope: "Run #3", value: "—" })!.now).toBe("Run #3: no reading yet.");
  });
});
