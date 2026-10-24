import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CHAT_SYSTEM, buildSnapshot } from "@/lib/chat-context";
import { CHAT_INPUT, CHAT_LIMITS, dbBump, takeChatToken, visitorId } from "@/lib/chat-limits";
import { getMarketStrip, getOverview, getStrategies } from "@/lib/queries";

export const maxDuration = 30;

const MODEL = "claude-haiku-5-5";
/** ~300 words of answer plus headroom for (low-effort) thinking. */
const MAX_TOKENS = 1200;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(CHAT_INPUT.maxTurnChars),
      }),
    )
    .min(1)
    .max(CHAT_INPUT.maxHistoryTurns * 2),
});

const fail = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers });

const DENIED = {
  minute: "Easy on the trigger, pilot. Comms cool down in a moment.",
  day: `That's your ${CHAT_LIMITS.perDay} transmissions for today, pilot. Channel reopens after midnight ET.`,
  global: "Comms bandwidth is spent for today across the whole Corps. Back after midnight ET.",
};

/**
 * JC-316 chat (Claude Haiku 5.5). Public but tightly budgeted: same-origin only, input size caps,
 * per-visitor and global daily limits (lib/chat-limits.ts), and a hard answer length. Messages are
 * never stored; the browser sends the short history with each question. Streams plain text back.
 */
export async function POST(req: Request) {
  if (process.env.CHAT_ENABLED === "off" || !process.env.ANTHROPIC_API_KEY) return fail(503, "Comms are offline.");

  // Browsers always send Origin on cross-site POSTs; reject anything not from this site.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return fail(403, "Wrong channel.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Transmission garbled.");
  const history = parsed.data.messages.slice(-CHAT_INPUT.maxHistoryTurns * 2);
  const question = history.at(-1)!;
  if (question.role !== "user" || question.content.length > CHAT_INPUT.maxQuestionChars)
    return fail(400, `Keep questions under ${CHAT_INPUT.maxQuestionChars} characters, pilot.`);
  // The API needs the conversation to start with a user turn.
  while (history[0]?.role !== "user") history.shift();

  const grant = await takeChatToken(visitorId(req), new Date(), dbBump);
  if (!grant.ok) return fail(429, DENIED[grant.scope], { "Retry-After": String(grant.retryAfterSec) });

  const [o, st, strip] = await Promise.all([getOverview(), getStrategies("all"), getMarketStrip()]);
  const snapshot = buildSnapshot({ o, st, strip, now: new Date() });

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "low" },
    system: [
      { type: "text", text: CHAT_SYSTEM, cache_control: { type: "ephemeral" } },
      { type: "text", text: snapshot },
    ],
    messages: history,
  });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta")
            controller.enqueue(encoder.encode(event.delta.text));
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\nI can't help with that one, pilot."));
        else if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode(" …[transmission cut]"));
      } catch (e) {
        console.warn("chat stream failed", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        const msg =
          e instanceof Anthropic.RateLimitError
            ? "Comms are congested. Try again shortly, pilot."
            : e instanceof Anthropic.AuthenticationError
              ? "Comms are offline (authentication)."
              : "Signal lost. Try again, pilot.";
        controller.enqueue(encoder.encode(`\n\n[${msg}]`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Chat-Remaining": String(grant.remainingToday),
    },
  });
}
