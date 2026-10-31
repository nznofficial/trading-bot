/**
 * Backfill historical headlines and score them, so the Simulator can replay the news gate and Herald.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-news.ts fetch [--months 12]    # Alpaca → news_items
 *   npx tsx --env-file=.env.local scripts/backfill-news.ts estimate [--months 12] # count unscored pairs + cost
 *   npx tsx --env-file=.env.local scripts/backfill-news.ts score --yes [--months 12]
 *   npx tsx --env-file=.env.local scripts/backfill-news.ts collect                # resume a submitted run
 *
 * Scoring goes through the Message Batches API (half price, usually done within the hour). Submitted batch
 * ids and their items are kept in .news-batches.json so `collect` can pick up where an interrupted run left off.
 * Every step is safe to re-run: inserts skip rows that already exist.
 */
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as alpaca from "../lib/alpaca";
import { assetClassOf, NEWS, OWNERS } from "../lib/config";
import { db, schema } from "../lib/db";
import { ScoreOutput, scoreRequest, scoreRows, unscoredItems, type ScoreItem } from "../lib/news";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const months = opt("months", 12);
const end = new Date();
const start = new Date(end.getTime() - months * 30.44 * 86_400_000);
const STATE = ".news-batches.json";
/** Requests per submitted batch (each request scores NEWS.scoreBatch pairs). */
const REQUESTS_PER_BATCH = 2000;

/** Haiku 5.5 list prices per million tokens (≤100K prompts); batches bill half. */
const PRICE = { input: 0.1, output: 0.5 };

type State = { batches: { id: string; items: Record<string, ScoreItem[]> }[] };
const loadState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : { batches: [] });
const saveState = (s: State) => writeFileSync(STATE, JSON.stringify(s));

const SYMBOLS = Object.keys(OWNERS).map((s) => (assetClassOf(s) === "crypto" ? s.replace("/", "") : s));

async function fetchNews() {
  const d = db();
  let total = 0;
  // A week at a time keeps memory flat and makes progress visible.
  for (let t = start.getTime(); t < end.getTime(); t += 7 * 86_400_000) {
    const from = new Date(t);
    const to = new Date(Math.min(t + 7 * 86_400_000, end.getTime()));
    const articles = await alpaca.getNews({ symbols: SYMBOLS, start: from, end: to });
    let added = 0;
    for (let i = 0; i < articles.length; i += 500) {
      const rows = articles.slice(i, i + 500).map((a) => ({
        id: a.id,
        createdAt: new Date(a.created_at),
        headline: a.headline,
        summary: a.summary ?? "",
        source: a.source,
        url: a.url || null,
        symbols: a.symbols,
      }));
      added += (await d.insert(schema.newsItems).values(rows).onConflictDoNothing().returning({ id: schema.newsItems.id })).length;
    }
    total += added;
    console.log(`${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}: ${articles.length} articles, ${added} new`);
  }
  console.log(`done: ${total} new articles`);
}

/** Every unscored pair in the window, a month at a time (newest first within each month). */
async function allUnscored(): Promise<ScoreItem[]> {
  const out: ScoreItem[] = [];
  for (let t = start.getTime(); t < end.getTime(); t += 30 * 86_400_000) {
    out.push(...(await unscoredItems(new Date(t), Infinity, new Date(Math.min(t + 30 * 86_400_000, end.getTime())), 1_000_000)));
  }
  return out;
}

async function estimate(items: ScoreItem[]) {
  const requests = Math.ceil(items.length / NEWS.scoreBatch);
  // Measured on live scoring: ~2,800 input and ~1,100 output tokens per 20-pair request.
  const inTok = requests * 2800;
  const outTok = requests * 1100;
  const cost = ((inTok / 1e6) * PRICE.input + (outTok / 1e6) * PRICE.output) / 2;
  console.log(`${items.length.toLocaleString()} unscored pairs → ${requests.toLocaleString()} requests`);
  console.log(`≈ ${(inTok / 1e6).toFixed(1)}M input + ${(outTok / 1e6).toFixed(1)}M output tokens ≈ $${cost.toFixed(2)} at batch prices`);
}

async function collect(client: Anthropic) {
  const state = loadState();
  for (const b of state.batches) {
    for (;;) {
      const batch = await client.messages.batches.retrieve(b.id);
      if (batch.processing_status === "ended") break;
      console.log(`${b.id}: ${batch.processing_status}, ${batch.request_counts.processing} processing`);
      await new Promise((r) => setTimeout(r, 60_000));
    }
    let written = 0;
    let failed = 0;
    for await (const r of await client.messages.batches.results(b.id)) {
      const items = b.items[r.custom_id];
      if (!items) continue;
      if (r.result.type !== "succeeded") {
        failed++;
        continue;
      }
      const text = r.result.message.content.find((c) => c.type === "text");
      const parsed = text ? ScoreOutput.safeParse(JSON.parse(text.text)) : null;
      if (!parsed?.success) {
        failed++;
        continue;
      }
      const rows = scoreRows(
        items.map((i) => ({ ...i, createdAt: new Date(i.createdAt) })),
        parsed.data,
      );
      if (rows.length) await db().insert(schema.newsScores).values(rows).onConflictDoNothing();
      written += rows.length;
    }
    console.log(`${b.id}: ${written} scores written, ${failed} requests failed (re-run score to retry them)`);
  }
  saveState({ batches: [] });
}

async function score() {
  const items = await allUnscored();
  await estimate(items);
  if (!flag("yes")) {
    console.log("Add --yes to submit.");
    return;
  }
  const client = new Anthropic();
  const state = loadState();
  const groups: ScoreItem[][] = [];
  for (let i = 0; i < items.length; i += NEWS.scoreBatch) groups.push(items.slice(i, i + NEWS.scoreBatch));
  for (let i = 0; i < groups.length; i += REQUESTS_PER_BATCH) {
    const chunk = groups.slice(i, i + REQUESTS_PER_BATCH);
    const map: Record<string, ScoreItem[]> = {};
    const requests = chunk.map((g, j) => {
      const id = `r${i + j}`;
      map[id] = g;
      return { custom_id: id, params: { ...scoreRequest(g), output_config: JSON.parse(JSON.stringify(scoreRequest(g).output_config)) } };
    });
    const batch = await client.messages.batches.create({ requests });
    state.batches.push({ id: batch.id, items: map });
    saveState(state);
    console.log(`submitted ${batch.id} (${requests.length} requests)`);
  }
  await collect(client);
}

async function main() {
  if (cmd === "fetch") await fetchNews();
  else if (cmd === "estimate") await estimate(await allUnscored());
  else if (cmd === "score") await score();
  else if (cmd === "collect") await collect(new Anthropic());
  else console.log("usage: backfill-news.ts fetch|estimate|score|collect [--months N] [--yes]");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
