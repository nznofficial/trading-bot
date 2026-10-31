import { eq } from "drizzle-orm";
import { z } from "zod";
import { CORE, HERALD, NEWS, RISK, STRATEGY_PARAMS, type StrategyId } from "./config";
import { db, schema } from "./db";
import { makeRsiRevert } from "./strategies/rsi-revert";
import { makeSmaCross } from "./strategies/sma-cross";
import type { Strategy } from "./strategies/types";

/** Unit tuning that can change at runtime (Hangar → Tune units). Code defaults live in config.ts. */
export const LiveParams = z.object({
  sma: z
    .object({
      fast: z.number().int().min(2).max(200),
      slow: z.number().int().min(3).max(400),
      crossLookback: z.number().int().min(1).max(20),
    })
    .refine((p) => p.fast < p.slow, "fast must be < slow"),
  rsi: z
    .object({
      period: z.number().int().min(2).max(100),
      entry: z.number().min(1).max(99),
      exit: z.number().min(1).max(99),
    })
    .refine((p) => p.entry < p.exit, "entry must be < exit"),
  /** UNIT-00 Bastion: SPY share of equity while SPY is above its 200-day average. Units trade in the rest. */
  core: z.object({
    enabled: z.boolean(),
    pct: z.number().min(0.1).max(0.9),
  }),
  /** News gate: strongly negative, material headlines block unit buys and tighten open stops (Bastion exempt). */
  news: z.object({
    gateEnabled: z.boolean(),
    vetoSentiment: z.number().min(-1).max(0),
    minMateriality: z.number().min(0).max(1),
    vetoHours: z.number().min(1).max(168),
    tightenPct: z.number().min(0.005).max(0.2),
  }),
  /** UNIT-03 Herald: buys on strongly positive, material headlines, holds `holdDays` trading days, in its own slice. */
  herald: z.object({
    enabled: z.boolean(),
    pct: z.number().min(0.02).max(0.3),
    entrySentiment: z.number().min(0).max(1),
    minMateriality: z.number().min(0).max(1),
    holdDays: z.number().int().min(1).max(30),
    maxPositions: z.number().int().min(1).max(10),
  }),
  /** Protective stop for both classes, as a fraction (0.05 = 5%). */
  stopLossPct: z.number().min(0.005).max(0.5),
  /** New entries per theater. Disabling never blocks exits or stop management. */
  stocksEnabled: z.boolean(),
  cryptoEnabled: z.boolean(),
});
export type LiveParams = z.infer<typeof LiveParams>;

export const DEFAULT_LIVE_PARAMS: LiveParams = {
  sma: { ...STRATEGY_PARAMS.sma_cross },
  rsi: { ...STRATEGY_PARAMS.rsi_revert },
  core: { enabled: true, pct: CORE.pct },
  news: {
    gateEnabled: true,
    vetoSentiment: NEWS.vetoSentiment,
    minMateriality: NEWS.minMateriality,
    vetoHours: NEWS.vetoHours,
    tightenPct: NEWS.tightenPct,
  },
  herald: {
    enabled: false,
    pct: HERALD.pct,
    entrySentiment: HERALD.entrySentiment,
    minMateriality: HERALD.minMateriality,
    holdDays: HERALD.holdDays,
    maxPositions: HERALD.maxPositions,
  },
  stopLossPct: RISK.stopLossPct,
  stocksEnabled: true,
  cryptoEnabled: true,
};

const KEY = "live_params";

export async function getLiveParams(): Promise<LiveParams> {
  const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, KEY));
  const parsed = LiveParams.safeParse({ ...DEFAULT_LIVE_PARAMS, ...((row?.value as object) ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_LIVE_PARAMS;
}

export async function saveLiveParams(p: LiveParams) {
  await db()
    .insert(schema.settings)
    .values({ key: KEY, value: p })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: p } });
}

/** Share of equity Vanguard and Recoil may hold together: what the core and an armed Herald leave. */
export const unitsMaxPct = (p: LiveParams) =>
  Math.max(0, (p.core.enabled ? 1 - p.core.pct : 1) - (p.herald.enabled ? p.herald.pct : 0));

export function buildUnits(p: LiveParams): Record<StrategyId, Strategy> {
  return { sma_cross: makeSmaCross(p.sma), rsi_revert: makeRsiRevert(p.rsi) };
}

/** Human-readable list of what changed, for the Sorties log. */
export function describeChanges(before: LiveParams, after: LiveParams): string[] {
  const out: string[] = [];
  const cmp = (label: string, a: unknown, b: unknown) => {
    if (a !== b) out.push(`${label} ${String(a)} → ${String(b)}`);
  };
  cmp("SMA fast", before.sma.fast, after.sma.fast);
  cmp("SMA slow", before.sma.slow, after.sma.slow);
  cmp("SMA cross window", before.sma.crossLookback, after.sma.crossLookback);
  cmp("core", before.core.enabled ? "armed" : "safed", after.core.enabled ? "armed" : "safed");
  cmp("core share %", Math.round(before.core.pct * 100), Math.round(after.core.pct * 100));
  cmp("RSI period", before.rsi.period, after.rsi.period);
  cmp("RSI buy below", before.rsi.entry, after.rsi.entry);
  cmp("RSI sell above", before.rsi.exit, after.rsi.exit);
  cmp("news gate", before.news.gateEnabled ? "armed" : "safed", after.news.gateEnabled ? "armed" : "safed");
  cmp("veto at sentiment ≤", before.news.vetoSentiment, after.news.vetoSentiment);
  cmp("veto materiality ≥", before.news.minMateriality, after.news.minMateriality);
  cmp("veto hours", before.news.vetoHours, after.news.vetoHours);
  cmp("veto stop %", (before.news.tightenPct * 100).toFixed(1), (after.news.tightenPct * 100).toFixed(1));
  cmp("Herald", before.herald.enabled ? "armed" : "safed", after.herald.enabled ? "armed" : "safed");
  cmp("Herald share %", Math.round(before.herald.pct * 100), Math.round(after.herald.pct * 100));
  cmp("Herald buy at sentiment ≥", before.herald.entrySentiment, after.herald.entrySentiment);
  cmp("Herald materiality ≥", before.herald.minMateriality, after.herald.minMateriality);
  cmp("Herald hold days", before.herald.holdDays, after.herald.holdDays);
  cmp("Herald max positions", before.herald.maxPositions, after.herald.maxPositions);
  cmp("stop %", (before.stopLossPct * 100).toFixed(1), (after.stopLossPct * 100).toFixed(1));
  cmp("stock entries", before.stocksEnabled ? "on" : "off", after.stocksEnabled ? "on" : "off");
  cmp("crypto entries", before.cryptoEnabled ? "on" : "off", after.cryptoEnabled ? "on" : "off");
  return out;
}
