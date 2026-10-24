import { describe, expect, it } from "vitest";
import { CHAT_SYSTEM } from "@/lib/chat-context";
import { CHAT_LIMITS, takeChatToken, takeVoiceBudget, VOICE_BUDGET, type Bump } from "@/lib/chat-limits";
import { chunkSpeech } from "@/lib/voice-lines";

/** In-memory stand-in for the Postgres counter table. */
function memoryBump() {
  const counts = new Map<string, number>();
  const bump: Bump = async (bucket, _exp, by = 1) => {
    const n = (counts.get(bucket) ?? 0) + by;
    counts.set(bucket, n);
    return n;
  };
  return { bump, counts };
}

const at = (iso: string) => new Date(iso);

describe("chat rate limits", () => {
  it("allows the per-minute burst, then refuses until the next minute", async () => {
    const { bump } = memoryBump();
    const now = at("2026-10-23T15:00:10Z");
    for (let i = 0; i < CHAT_LIMITS.perMinute; i++) expect((await takeChatToken("a", now, bump)).ok).toBe(true);
    const denied = await takeChatToken("a", now, bump);
    expect(denied).toEqual({ ok: false, scope: "minute", retryAfterSec: 50 });
    expect((await takeChatToken("a", at("2026-10-23T15:01:01Z"), bump)).ok).toBe(true);
  });

  it("caps each visitor per day and reports what's left", async () => {
    const { bump } = memoryBump();
    let last;
    for (let i = 0; i < CHAT_LIMITS.perDay; i++) last = await takeChatToken("b", new Date(Date.UTC(2026, 9, 23, 14, i)), bump);
    expect(last).toEqual({ ok: true, remainingToday: 0 });
    const denied = await takeChatToken("b", at("2026-10-23T14:59:00Z"), bump);
    expect(denied.ok === false && denied.scope).toBe("day");
    // The day rolls over at midnight New York time (04:00Z in EDT).
    expect((await takeChatToken("b", at("2026-10-24T04:00:30Z"), bump)).ok).toBe(true);
  });

  it("caps everyone combined", async () => {
    const { bump } = memoryBump();
    for (let i = 0; i < CHAT_LIMITS.globalPerDay; i++)
      expect((await takeChatToken(`v${i}`, at("2026-10-23T15:00:00Z"), bump)).ok).toBe(true);
    const denied = await takeChatToken("late", at("2026-10-23T15:00:00Z"), bump);
    expect(denied.ok === false && denied.scope).toBe("global");
  });

  it("a visitor stuck on the minute limit doesn't burn daily or global quota", async () => {
    const { bump, counts } = memoryBump();
    const now = at("2026-10-23T15:00:00Z");
    for (let i = 0; i < 50; i++) await takeChatToken("spam", now, bump);
    expect(counts.get("v:spam:d:2026-10-23")).toBe(CHAT_LIMITS.perMinute);
    expect(counts.get("g:d:2026-10-23")).toBe(CHAT_LIMITS.perMinute);
  });
});

describe("chat brief", () => {
  it("is static (cacheable) and states the scope and accuracy rules", () => {
    expect(CHAT_SYSTEM).not.toMatch(/undefined|NaN/);
    expect(CHAT_SYSTEM).toContain("Outside my mission parameters");
    expect(CHAT_SYSTEM).toContain("Never give personal investment advice");
    expect(CHAT_SYSTEM).toContain("NVDA");
  });
});

describe("voice replies", () => {
  it("only verifies signatures it issued", async () => {
    process.env.CRON_SECRET = "test-secret";
    const { signReply, verifyReply } = await import("@/lib/chat-limits");
    const sig = signReply("Hello, pilot.")!;
    expect(verifyReply("Hello, pilot.", sig)).toBe(true);
    expect(verifyReply("Say something else.", sig)).toBe(false);
    expect(verifyReply("Hello, pilot.", "forged")).toBe(false);
  });
});

describe("voice budget", () => {
  it("charges characters, per visitor and overall", async () => {
    const { bump } = memoryBump();
    const now = new Date("2026-10-23T15:00:00Z");
    const first = await takeVoiceBudget("a", 300, now, bump);
    expect(first).toEqual({ ok: true, remainingToday: VOICE_BUDGET.visitorCharsPerDay - 300 });
    const big = await takeVoiceBudget("a", VOICE_BUDGET.visitorCharsPerDay, new Date("2026-10-23T15:05:00Z"), bump);
    expect(big.ok === false && big.scope).toBe("day");
  });

  it("splits replies into sentence chunks with a short first one", () => {
    const parts = chunkSpeech("Pilot, equity is $100,045.73 today. Three positions open. " + "More detail here. ".repeat(30));
    expect(parts[0]).toMatch(/^Pilot, equity is \$100,045\.73 today\. Three positions open\./);
    expect(parts[0].length).toBeLessThanOrEqual(170);
    expect(parts.every((p) => p.length <= 320)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toContain("$100,045.73");
  });
});
