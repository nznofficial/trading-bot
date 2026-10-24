import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { tradingDay } from "./analytics";
import { db, schema } from "./db";

export type Limits = { perMinute: number; perDay: number; globalPerDay: number };

/** JC-316 chat budget. Per visitor (salted IP hash) and for everyone combined. */
export const CHAT_LIMITS: Limits = { perMinute: 5, perDay: 30, globalPerDay: 300 };

/**
 * Spoken lines (ElevenLabs bills per character) are budgeted in characters, not messages: a cap per
 * visitor per day and a ceiling for everyone combined (VOICE_DAILY_CHARS overrides it). Requests
 * per minute are capped too, generously, since one long reply is fetched in a few chunks.
 */
export const VOICE_BUDGET = {
  requestsPerMinute: 24,
  visitorCharsPerDay: 8_000,
  globalCharsPerDay: Number(process.env.VOICE_DAILY_CHARS) || 30_000,
};

/** Input caps: what one request may carry. Answers are capped by max_tokens in the route. */
export const CHAT_INPUT = { maxQuestionChars: 500, maxHistoryTurns: 10, maxTurnChars: 2000 };

export type ChatDenial = { ok: false; scope: "minute" | "day" | "global"; retryAfterSec: number };
export type ChatGrant = { ok: true; remainingToday: number };

/** Increase a counter bucket by `by` (default 1) and return its new value (creating it with an expiry if new). */
export type Bump = (bucket: string, expiresAt: Date, by?: number) => Promise<number>;

const MINUTE = 60_000;
const DAY = 86_400_000;

/**
 * Take one message from the budget. Checks run narrowest first and stop at the first refusal, so a
 * visitor hammering the per-minute limit can't burn their daily quota or everyone's global one.
 * Days roll over at midnight New York time (the trading day).
 */
export async function takeChatToken(
  visitor: string,
  now: Date,
  bump: Bump,
  limits: Limits = CHAT_LIMITS,
  prefix = "",
): Promise<ChatGrant | ChatDenial> {
  const minute = Math.floor(now.getTime() / MINUTE);
  const day = tradingDay(now);
  const secsToMinute = Math.ceil(((minute + 1) * MINUTE - now.getTime()) / 1000);

  if ((await bump(`${prefix}v:${visitor}:m:${minute}`, new Date((minute + 2) * MINUTE))) > limits.perMinute)
    return { ok: false, scope: "minute", retryAfterSec: secsToMinute };
  const today = await bump(`${prefix}v:${visitor}:d:${day}`, new Date(now.getTime() + 2 * DAY));
  if (today > limits.perDay) return { ok: false, scope: "day", retryAfterSec: secondsToNyMidnight(now) };
  if ((await bump(`${prefix}g:d:${day}`, new Date(now.getTime() + 2 * DAY))) > limits.globalPerDay)
    return { ok: false, scope: "global", retryAfterSec: secondsToNyMidnight(now) };
  return { ok: true, remainingToday: limits.perDay - today };
}

function secondsToNyMidnight(now: Date) {
  // Step forward in 15-minute increments until the New York date changes (DST-safe, at most 96 steps).
  const day = tradingDay(now);
  let t = now.getTime();
  while (tradingDay(new Date(t)) === day) t += 15 * MINUTE;
  return Math.max(60, Math.ceil((t - now.getTime()) / 1000));
}

/**
 * Take `chars` characters of speech from the voice budget. Same narrowest-first rule as chat: a
 * refused request doesn't consume the wider budgets.
 */
export async function takeVoiceBudget(visitor: string, chars: number, now: Date, bump: Bump): Promise<ChatGrant | ChatDenial> {
  const minute = Math.floor(now.getTime() / MINUTE);
  const day = tradingDay(now);
  if ((await bump(`voice:v:${visitor}:m:${minute}`, new Date((minute + 2) * MINUTE))) > VOICE_BUDGET.requestsPerMinute)
    return { ok: false, scope: "minute", retryAfterSec: Math.ceil(((minute + 1) * MINUTE - now.getTime()) / 1000) };
  const mine = await bump(`voice:v:${visitor}:c:${day}`, new Date(now.getTime() + 2 * DAY), chars);
  if (mine > VOICE_BUDGET.visitorCharsPerDay) return { ok: false, scope: "day", retryAfterSec: secondsToNyMidnight(now) };
  if ((await bump(`voice:g:c:${day}`, new Date(now.getTime() + 2 * DAY), chars)) > VOICE_BUDGET.globalCharsPerDay)
    return { ok: false, scope: "global", retryAfterSec: secondsToNyMidnight(now) };
  return { ok: true, remainingToday: VOICE_BUDGET.visitorCharsPerDay - mine };
}

/** Postgres-backed counter: one atomic upsert per bump. */
export const dbBump: Bump = async (bucket, expiresAt, by = 1) => {
  const [row] = await db()
    .insert(schema.chatCounters)
    .values({ bucket, count: by, expiresAt })
    .onConflictDoUpdate({ target: schema.chatCounters.bucket, set: { count: sql`${schema.chatCounters.count} + ${by}` } })
    .returning({ count: schema.chatCounters.count });
  return row.count;
};

/** Stable, non-reversible visitor id from the request's IP (salted so the table never holds raw IPs). */
export function visitorId(req: Request) {
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const salt = process.env.CRON_SECRET ?? "mmc";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 24);
}

/**
 * Replies are signed so /api/voice only speaks text JC-316 actually generated, never arbitrary
 * text (which would turn it into a free text-to-speech service for anyone).
 */
export function signReply(text: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  return createHmac("sha256", `voice:${secret}`).update(text).digest("base64url");
}

export function verifyReply(text: string, sig: string) {
  const expected = signReply(text);
  if (!expected || expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
