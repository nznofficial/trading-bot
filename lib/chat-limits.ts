import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { tradingDay } from "./analytics";
import { db, schema } from "./db";

/** JC-316 chat budget. Per visitor (salted IP hash) and for everyone combined. */
export const CHAT_LIMITS = { perMinute: 5, perDay: 30, globalPerDay: 300 };

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
export async function takeChatToken(visitor: string, now: Date, bump: Bump): Promise<ChatGrant | ChatDenial> {
  const minute = Math.floor(now.getTime() / MINUTE);
  const day = tradingDay(now);
  const secsToMinute = Math.ceil(((minute + 1) * MINUTE - now.getTime()) / 1000);

  if ((await bump(`v:${visitor}:m:${minute}`, new Date((minute + 2) * MINUTE))) > CHAT_LIMITS.perMinute)
    return { ok: false, scope: "minute", retryAfterSec: secsToMinute };
  const today = await bump(`v:${visitor}:d:${day}`, new Date(now.getTime() + 2 * DAY));
  if (today > CHAT_LIMITS.perDay) return { ok: false, scope: "day", retryAfterSec: secondsToNyMidnight(now) };
  if ((await bump(`g:d:${day}`, new Date(now.getTime() + 2 * DAY))) > CHAT_LIMITS.globalPerDay)
    return { ok: false, scope: "global", retryAfterSec: secondsToNyMidnight(now) };
  return { ok: true, remainingToday: CHAT_LIMITS.perDay - today };
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
