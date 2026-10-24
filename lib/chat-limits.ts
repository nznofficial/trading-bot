import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { tradingDay } from "./analytics";
import { db, schema } from "./db";

export type Limits = { perMinute: number; perDay: number; globalPerDay: number };

/** JC-316 chat budget. Per visitor (salted IP hash) and for everyone combined. */
export const CHAT_LIMITS: Limits = { perMinute: 5, perDay: 30, globalPerDay: 300 };

/**
 * Spoken replies (ElevenLabs) are pricier per message than text, so they get a tighter budget.
 * VOICE_DAILY_CAP overrides the global cap.
 */
export const VOICE_LIMITS: Limits = {
  perMinute: 3,
  perDay: 10,
  globalPerDay: Number(process.env.VOICE_DAILY_CAP) || 25,
};

/** Input caps: what one request may carry. Answers are capped by max_tokens in the route. */
export const CHAT_INPUT = { maxQuestionChars: 500, maxHistoryTurns: 10, maxTurnChars: 2000 };

export type ChatDenial = { ok: false; scope: "minute" | "day" | "global"; retryAfterSec: number };
export type ChatGrant = { ok: true; remainingToday: number };

/** Increment a counter bucket and return its new count (creating it with an expiry if new). */
export type Bump = (bucket: string, expiresAt: Date) => Promise<number>;

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

/** Postgres-backed counter: one atomic upsert per bump. */
export const dbBump: Bump = async (bucket, expiresAt) => {
  const [row] = await db()
    .insert(schema.chatCounters)
    .values({ bucket, count: 1, expiresAt })
    .onConflictDoUpdate({ target: schema.chatCounters.bucket, set: { count: sql`${schema.chatCounters.count} + 1` } })
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

/** The bit worth hearing: the first two sentences, capped. Decimals like $14.66 don't end a sentence. */
export function speakable(text: string, max = 260) {
  const sentences = text.replace(/\s+/g, " ").trim().match(/.+?[.!?]+["”’)]*(?=\s|$)/g) ?? [text];
  let out = "";
  for (const s of sentences.slice(0, 2)) {
    if (out && (out + s).length > max) break;
    out += s;
  }
  return out.trim().slice(0, max);
}
