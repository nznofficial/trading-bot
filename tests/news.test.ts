import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_PARAMS, unitsMaxPct } from "@/lib/live-params";
import { createRiskGate, sizeHerald } from "@/lib/risk";
import {
  heraldCall,
  isVeto,
  pairKey,
  scorePrompt,
  scoreRows,
  tightenedStop,
  trackedSymbols,
  vetoesAt,
  vetoNote,
  type ScoredHeadline,
} from "@/lib/news";

const P = { vetoSentiment: -0.6, minMateriality: 0.7, vetoHours: 24, tightenPct: 0.02 };
const at = (iso: string) => new Date(iso);
const h = (o: Partial<ScoredHeadline>): ScoredHeadline => ({
  newsId: 1,
  symbol: "TSLA",
  createdAt: at("2026-10-30T14:00:00Z"),
  sentiment: -0.9,
  materiality: 0.9,
  headline: "NHTSA opens probe into Tesla",
  ...o,
});

describe("veto rule", () => {
  it("needs both strongly negative sentiment and materiality", () => {
    expect(isVeto({ sentiment: -0.9, materiality: 0.9 }, P)).toBe(true);
    expect(isVeto({ sentiment: -0.6, materiality: 0.7 }, P)).toBe(true);
    expect(isVeto({ sentiment: -0.9, materiality: 0.5 }, P)).toBe(false);
    expect(isVeto({ sentiment: -0.4, materiality: 0.9 }, P)).toBe(false);
  });

  it("starts at the headline and expires after vetoHours", () => {
    const s = [h({})];
    expect(vetoesAt(s, at("2026-10-30T13:59:00Z"), P).size).toBe(0); // not published yet
    expect(vetoesAt(s, at("2026-10-30T14:00:00Z"), P).get("TSLA")?.expiresAt.toISOString()).toBe("2026-10-31T14:00:00.000Z");
    expect(vetoesAt(s, at("2026-10-31T13:59:00Z"), P).has("TSLA")).toBe(true);
    expect(vetoesAt(s, at("2026-10-31T14:00:00Z"), P).has("TSLA")).toBe(false);
  });

  it("keeps the longest-running veto per symbol and ignores non-vetoes", () => {
    const s = [h({ newsId: 1 }), h({ newsId: 2, createdAt: at("2026-10-30T18:00:00Z") }), h({ newsId: 3, symbol: "NVDA", sentiment: 0.8 })];
    const v = vetoesAt(s, at("2026-10-30T19:00:00Z"), P);
    expect([...v.keys()]).toEqual(["TSLA"]);
    expect(v.get("TSLA")?.newsId).toBe(2);
  });

  it("describes itself for signal notes", () => {
    const v = vetoesAt([h({})], at("2026-10-30T15:00:00Z"), P).get("TSLA")!;
    expect(vetoNote(v)).toBe('news veto (-0.9 "NHTSA opens probe into Tesla") until 2026-10-31T14:00Z');
  });
});

describe("tightenedStop", () => {
  it("lifts the stop to tightenPct under the price", () => {
    expect(tightenedStop(95, 100, 0.02)).toBe(98);
  });
  it("never lowers a stop or repeats one already tight enough", () => {
    expect(tightenedStop(98.5, 100, 0.02)).toBeNull();
    expect(tightenedStop(98, 100, 0.02)).toBeNull();
  });
  it("handles a missing stop and bad prices", () => {
    expect(tightenedStop(null, 50, 0.02)).toBe(49);
    expect(tightenedStop(10, 0, 0.02)).toBeNull();
  });
});

describe("article symbols", () => {
  it("keeps only tracked symbols, normalizes crypto, and caps roundups", () => {
    expect(trackedSymbols(["NVDA", "INTC", "BTCUSD", "NVDA"])).toEqual(["NVDA", "BTC/USD"]);
    expect(trackedSymbols(["AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "AMD", "JPM"])).toHaveLength(6);
  });
});

describe("scoring I/O", () => {
  const items = [
    { key: pairKey(7, "NVDA"), symbol: "NVDA", createdAt: at("2026-10-30T14:00:00Z"), headline: "Nvidia beats", summary: "Q3 beat." },
    { key: pairKey(7, "AMD"), symbol: "AMD", createdAt: at("2026-10-30T14:00:00Z"), headline: "Nvidia beats", summary: "" },
  ];

  it("labels every item with its key, symbol and time", () => {
    const p = scorePrompt(items);
    expect(p).toContain('<item key="7:NVDA" symbol="NVDA" at="2026-10-30T14:00:00.000Z">');
    expect(p).toContain("Summary: Q3 beat.");
    expect(p.match(/Summary:/g)).toHaveLength(1);
  });

  it("clamps values, drops unknown and duplicate keys", () => {
    const rows = scoreRows(items, {
      scores: [
        { key: "7:NVDA", sentiment: 1.4, materiality: 0.8, category: "earnings", rationale: "Beat." },
        { key: "7:NVDA", sentiment: -1, materiality: 0, category: "other", rationale: "dup" },
        { key: "9:XYZ", sentiment: 0, materiality: 0, category: "other", rationale: "?" },
        { key: "7:AMD", sentiment: 0, materiality: -0.2, category: "gossip", rationale: "Mention." },
      ],
    });
    expect(rows.map((r) => [r.newsId, r.symbol, r.sentiment, r.materiality, r.category])).toEqual([
      [7, "NVDA", 1, 0.8, "earnings"],
      [7, "AMD", 0, 0, "other"],
    ]);
  });
});

describe("sleeves", () => {
  it("an armed Herald takes its slice out of the units' room", () => {
    expect(unitsMaxPct(DEFAULT_LIVE_PARAMS)).toBeCloseTo(0.3);
    expect(unitsMaxPct({ ...DEFAULT_LIVE_PARAMS, herald: { ...DEFAULT_LIVE_PARAMS.herald, enabled: true } })).toBeCloseTo(0.2);
  });
});

describe("heraldCall", () => {
  const trig = (iso: string) => h({ symbol: "JPM", createdAt: at(iso), sentiment: 0.8 });
  const base = { holdDays: 5, tradingDaysSince: () => 0 };

  it("buys only a headline that landed since the previous bar closed", () => {
    const triggers = [trig("2026-10-30T13:00:00Z")];
    expect(heraldCall({ ...base, triggers, held: false, prevClose: at("2026-10-29T20:00:00Z"), now: at("2026-10-30T13:45:00Z") }).action).toBe("buy");
    expect(heraldCall({ ...base, triggers, held: false, prevClose: at("2026-10-30T13:30:00Z"), now: at("2026-10-30T13:45:00Z") }).action).toBe("hold");
  });

  it("ignores headlines after now", () => {
    const triggers = [trig("2026-10-30T14:00:00Z")];
    expect(heraldCall({ ...base, triggers, held: false, prevClose: null, now: at("2026-10-30T13:45:00Z") }).action).toBe("hold");
  });

  it("sells once holdDays sessions have passed since the latest trigger", () => {
    const triggers = [trig("2026-10-20T13:00:00Z"), trig("2026-10-27T13:00:00Z")];
    const call = (days: number) =>
      heraldCall({ triggers, held: true, prevClose: null, now: at("2026-10-30T15:00:00Z"), holdDays: 5, tradingDaysSince: () => days }).action;
    expect(call(4)).toBe("hold");
    expect(call(5)).toBe("sell");
  });
});

describe("sizeHerald", () => {
  const a = {
    symbol: "JPM",
    price: 100,
    equity: 100_000,
    lastEquity: 100_000,
    pct: 0.1,
    maxPositions: 3,
    exposure: 0,
    count: 0,
    buyingPower: 50_000,
    stopLossPct: 0.05,
    held: false,
    orderPending: false,
  };
  it("takes an even share of the slice with the normal stop", () => {
    expect(sizeHerald(a)).toEqual({ ok: true, qty: 33, stopLoss: 95 });
  });
  it("respects the slice, the position count, and the daily loss halt", () => {
    expect(sizeHerald({ ...a, exposure: 9_950 })).toMatchObject({ ok: false });
    expect(sizeHerald({ ...a, count: 3 })).toMatchObject({ ok: false, reason: "Herald max 3 positions" });
    expect(sizeHerald({ ...a, equity: 96_000 })).toMatchObject({ ok: false });
  });
});

describe("units gate with a Herald sleeve", () => {
  it("Herald's positions don't use up the units' position limit", () => {
    const held = new Set(["JPM", "V", "MA", "LLY", "XOM", "KO", "PG", "HD"]);
    const state = { equity: 100_000, lastEquity: 100_000, buyingPower: 100_000, heldSymbols: held, symbolsWithOpenOrders: new Set<string>() };
    expect(createRiskGate(state).approveEntry("AAPL", 100).ok).toBe(false);
    expect(createRiskGate({ ...state, otherSleeve: held }).approveEntry("AAPL", 100).ok).toBe(true);
  });
});
