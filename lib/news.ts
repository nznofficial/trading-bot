import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq, gt, gte, inArray, lt, lte } from "drizzle-orm";
import { z } from "zod";
import * as alpaca from "./alpaca";
import { assetClassOf, CORE, HERALD, NEWS, normalizeSymbol, OWNERS } from "./config";
import { db, schema } from "./db";
import { round2 } from "./risk";

/**
 * The news layer's rules, shared by the live engine and the backtest so both act the same way.
 * Everything here only looks at headlines published at or before `now`.
 */

export type GateParams = { vetoSentiment: number; minMateriality: number; vetoHours: number; tightenPct: number };
export type ScoredHeadline = {
  newsId: number;
  symbol: string;
  createdAt: Date;
  sentiment: number;
  materiality: number;
  headline: string;
};
export type Veto = ScoredHeadline & { expiresAt: Date };

export const CATEGORIES = ["earnings", "guidance", "analyst", "legal_regulatory", "mna", "product", "macro", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const isVeto = (s: Pick<ScoredHeadline, "sentiment" | "materiality">, p: GateParams) =>
  s.sentiment <= p.vetoSentiment && s.materiality >= p.minMateriality;

/** Active vetoes at `now`, one per symbol (the one that runs longest). */
export function vetoesAt(scores: ScoredHeadline[], now: Date, p: GateParams): Map<string, Veto> {
  const out = new Map<string, Veto>();
  const t = now.getTime();
  for (const s of scores) {
    if (!isVeto(s, p)) continue;
    const start = s.createdAt.getTime();
    const end = start + p.vetoHours * 3_600_000;
    if (start > t || end <= t) continue;
    const prev = out.get(s.symbol);
    if (!prev || prev.expiresAt.getTime() < end) out.set(s.symbol, { ...s, expiresAt: new Date(end) });
  }
  return out;
}

/**
 * Stop after a veto: `tightenPct` below the price, but never lower than the current stop and never at or
 * above the price. Returns null when the current stop is already at least that tight.
 */
export function tightenedStop(currentStop: number | null, price: number, tightenPct: number): number | null {
  if (!(price > 0)) return null;
  const target = round2(price * (1 - tightenPct));
  if (target >= price) return null;
  if (currentStop !== null && currentStop >= target) return null;
  return target;
}

export type HeraldParams = { entrySentiment: number; minMateriality: number; holdDays: number };

export const isHeraldTrigger = (s: Pick<ScoredHeadline, "sentiment" | "materiality">, h: HeraldParams) =>
  s.sentiment >= h.entrySentiment && s.materiality >= h.minMateriality;

/**
 * Herald's call on one symbol at a bar close. `triggers` are its qualifying headlines up to `now`, newest
 * last. Buy when one landed since the previous bar closed; once held, sell after `holdDays` trading days
 * from the latest one (a fresh trigger while holding extends the hold). `tradingDaysSince(t)` counts
 * completed sessions between the headline and now.
 */
export function heraldCall(args: {
  triggers: ScoredHeadline[];
  held: boolean;
  prevClose: Date | null;
  now: Date;
  holdDays: number;
  tradingDaysSince: (t: Date) => number;
}): { action: "buy" | "sell" | "hold"; trigger: ScoredHeadline | null } {
  const latest = args.triggers.filter((t) => t.createdAt.getTime() <= args.now.getTime()).at(-1) ?? null;
  if (!latest) return { action: args.held ? "sell" : "hold", trigger: null };
  if (!args.held) {
    const fresh = !args.prevClose || latest.createdAt.getTime() > args.prevClose.getTime();
    return { action: fresh ? "buy" : "hold", trigger: latest };
  }
  return { action: args.tradingDaysSince(latest.createdAt) >= args.holdDays ? "sell" : "hold", trigger: latest };
}

/** One-line description of a veto for signal notes and the Intel page. */
export function vetoNote(v: Veto) {
  const h = v.headline.length > 60 ? `${v.headline.slice(0, 59)}…` : v.headline;
  return `news veto (${v.sentiment >= 0 ? "+" : ""}${v.sentiment.toFixed(1)} "${h}") until ${v.expiresAt.toISOString().slice(0, 16)}Z`;
}

/** Symbols the gate acts on: the TA units' always, Herald's only while it's armed. Bastion's SPY never. */
export function gateWatches(symbol: string, heraldArmed: boolean) {
  const owner = OWNERS[symbol];
  if (!owner || owner === CORE.id) return false;
  return owner !== HERALD.id || heraldArmed;
}

/** Tracked symbols an article is tagged with, in article order, capped so roundups don't fan out. */
export function trackedSymbols(articleSymbols: string[]): string[] {
  const out: string[] = [];
  for (const raw of articleSymbols) {
    const s = normalizeSymbol(raw);
    if (s in OWNERS && !out.includes(s)) out.push(s);
    if (out.length >= NEWS.maxSymbolsPerArticle) break;
  }
  return out;
}

// --- Sync ------------------------------------------------------------------------------------

const CURSOR_KEY = "news_cursor";
/** Alpaca sometimes indexes an article minutes after its timestamp; re-read this much overlap. */
const OVERLAP_MS = 30 * 60_000;

/** News query symbols in Alpaca's form (crypto without the slash). */
const QUERY_SYMBOLS = Object.keys(OWNERS).map((s) => (assetClassOf(s) === "crypto" ? s.replace("/", "") : s));

/** Pull new headlines for every tracked symbol into news_items. Returns how many were new. */
export async function syncNews(now: Date): Promise<number> {
  const d = db();
  const [row] = await d.select().from(schema.settings).where(eq(schema.settings.key, CURSOR_KEY));
  const cursor = typeof row?.value === "string" ? new Date(row.value) : new Date(now.getTime() - NEWS.initialLookbackHours * 3_600_000);
  const start = new Date(cursor.getTime() - OVERLAP_MS);

  const articles = await alpaca.getNews({ symbols: QUERY_SYMBOLS, start, end: now, maxPages: 10 });
  let added = 0;
  if (articles.length) {
    const rows = articles.map((a) => ({
      id: a.id,
      createdAt: new Date(a.created_at),
      headline: a.headline,
      summary: a.summary ?? "",
      source: a.source,
      url: a.url || null,
      symbols: a.symbols,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const res = await d
        .insert(schema.newsItems)
        .values(rows.slice(i, i + 200))
        .onConflictDoNothing()
        .returning({ id: schema.newsItems.id });
      added += res.length;
    }
  }
  const newest = articles.reduce((m, a) => Math.max(m, Date.parse(a.created_at)), cursor.getTime());
  await d
    .insert(schema.settings)
    .values({ key: CURSOR_KEY, value: new Date(newest).toISOString() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: new Date(newest).toISOString() } });
  return added;
}

// --- Scoring ---------------------------------------------------------------------------------

export const SCORE_SYSTEM = `You score financial news headlines for an automated trading system.

For each item you get a stock symbol, a timestamp, a headline and usually a short summary. Judge the item only from its text, as a trader reading it at that timestamp would. Do not use anything you may know about events after the timestamp.

For each item return:
- sentiment: from -1 (clearly bad for this symbol's stock) to 1 (clearly good). 0 means neutral or unclear. Score the effect on the given symbol, not on the market or other companies in the story.
- materiality: from 0 (noise: recaps, listicles, "stocks to watch", price-move reports with no new facts, opinion pieces) to 1 (genuinely new information likely to move this stock over the next few days: earnings results, guidance changes, major regulatory or legal action, M&A, large contracts, rating changes from major banks). An article that only mentions the symbol in passing is low materiality for it.
- category: one of ${CATEGORIES.join(", ")}.
- rationale: one short sentence.

Return exactly one entry per input item, echoing its key.`;

export const ScoreOutput = z.object({
  scores: z.array(
    z.object({
      key: z.string(),
      sentiment: z.number(),
      materiality: z.number(),
      /** One of CATEGORIES; anything else is filed as "other". */
      category: z.string(),
      rationale: z.string(),
    }),
  ),
});
export type ScoreOutput = z.infer<typeof ScoreOutput>;

export type ScoreItem = { key: string; symbol: string; createdAt: Date; headline: string; summary: string };

export const pairKey = (newsId: number, symbol: string) => `${newsId}:${symbol}`;

export function scorePrompt(items: ScoreItem[]): string {
  return items
    .map((i) =>
      [`<item key="${i.key}" symbol="${i.symbol}" at="${i.createdAt.toISOString()}">`, i.headline, i.summary ? `Summary: ${i.summary}` : null, "</item>"]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

/** Request body for one scoring call (also used by the backfill's Message Batches). */
export function scoreRequest(items: ScoreItem[]) {
  return {
    model: NEWS.model,
    max_tokens: 8000,
    output_config: { effort: "low" as const, format: zodOutputFormat(ScoreOutput) },
    system: SCORE_SYSTEM,
    messages: [{ role: "user" as const, content: scorePrompt(items) }],
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : 0));

/** Turn a model reply into score rows, dropping keys we didn't ask about. */
export function scoreRows(items: ScoreItem[], out: ScoreOutput, model: string = NEWS.model) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const rows: (typeof schema.newsScores.$inferInsert)[] = [];
  for (const s of out.scores) {
    const item = byKey.get(s.key);
    if (!item) continue;
    byKey.delete(s.key);
    const [id] = s.key.split(":");
    rows.push({
      newsId: Number(id),
      symbol: item.symbol,
      createdAt: item.createdAt,
      sentiment: clamp(s.sentiment, -1, 1),
      materiality: clamp(s.materiality, 0, 1),
      category: (CATEGORIES as readonly string[]).includes(s.category) ? s.category : "other",
      rationale: s.rationale.slice(0, 300),
      model,
    });
  }
  return rows;
}

/**
 * (article, symbol) pairs published in [from, to) that have no score yet, newest first (fresh news gates
 * trades). Looks at up to `maxArticles` articles.
 */
export async function unscoredItems(from: Date, limit: number, to?: Date, maxArticles = 2000): Promise<ScoreItem[]> {
  const d = db();
  const articles = await d
    .select()
    .from(schema.newsItems)
    .where(and(gte(schema.newsItems.createdAt, from), to ? lt(schema.newsItems.createdAt, to) : undefined))
    .orderBy(desc(schema.newsItems.createdAt))
    .limit(maxArticles);
  if (!articles.length) return [];
  const done = new Set<string>();
  const ids = articles.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await d
      .select({ newsId: schema.newsScores.newsId, symbol: schema.newsScores.symbol })
      .from(schema.newsScores)
      .where(inArray(schema.newsScores.newsId, ids.slice(i, i + 500)));
    for (const r of rows) done.add(pairKey(r.newsId, r.symbol));
  }
  const out: ScoreItem[] = [];
  for (const a of articles) {
    for (const symbol of trackedSymbols(a.symbols)) {
      const key = pairKey(a.id, symbol);
      if (done.has(key)) continue;
      out.push({ key, symbol, createdAt: a.createdAt, headline: a.headline, summary: a.summary });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Score unscored recent pairs with Claude until `deadline` (epoch ms) or the per-tick cap.
 * Returns how many pairs were scored. A failed batch is left for the next tick.
 */
export async function scoreNews(now: Date, deadline: number): Promise<{ scored: number; pending: number; error?: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { scored: 0, pending: 0, error: "ANTHROPIC_API_KEY not set" };
  const items = await unscoredItems(new Date(now.getTime() - 3 * 86_400_000), NEWS.scorePerTick);
  const client = new Anthropic({ timeout: 25_000, maxRetries: 1 });
  let scored = 0;
  let error: string | undefined;
  for (let i = 0; i < items.length; i += NEWS.scoreBatch) {
    if (Date.now() > deadline) break;
    const batch = items.slice(i, i + NEWS.scoreBatch);
    try {
      const res = await client.messages.parse(scoreRequest(batch));
      if (res.stop_reason === "refusal" || !res.parsed_output) {
        error = `scoring stopped: ${res.stop_reason}`;
        continue;
      }
      const rows = scoreRows(batch, res.parsed_output);
      if (rows.length) await db().insert(schema.newsScores).values(rows).onConflictDoNothing();
      scored += rows.length;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  return { scored, pending: items.length - scored, error };
}

// --- Lookups ---------------------------------------------------------------------------------

/** Scored headlines for `symbols` published in (from, to]. */
export async function scoredHeadlines(from: Date, to: Date, symbols?: string[]): Promise<ScoredHeadline[]> {
  const rows = await db()
    .select({
      newsId: schema.newsScores.newsId,
      symbol: schema.newsScores.symbol,
      createdAt: schema.newsScores.createdAt,
      sentiment: schema.newsScores.sentiment,
      materiality: schema.newsScores.materiality,
      headline: schema.newsItems.headline,
    })
    .from(schema.newsScores)
    .innerJoin(schema.newsItems, eq(schema.newsItems.id, schema.newsScores.newsId))
    .where(
      and(
        gt(schema.newsScores.createdAt, from),
        lte(schema.newsScores.createdAt, to),
        symbols ? inArray(schema.newsScores.symbol, symbols) : undefined,
      ),
    )
    .orderBy(desc(schema.newsScores.createdAt));
  return rows;
}

export async function activeVetoes(now: Date, p: GateParams): Promise<Map<string, Veto>> {
  return vetoesAt(await scoredHeadlines(new Date(now.getTime() - p.vetoHours * 3_600_000), now), now, p);
}

export type NewsActionRow = typeof schema.newsActions.$inferInsert;

/** Log news actions; the (news, symbol, kind) unique index keeps each one to a single row. */
export async function recordNewsActions(rows: NewsActionRow[]): Promise<NewsActionRow[]> {
  if (!rows.length) return [];
  const inserted = await db().insert(schema.newsActions).values(rows).onConflictDoNothing().returning();
  return inserted;
}
