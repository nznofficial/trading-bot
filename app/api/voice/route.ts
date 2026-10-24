import { z } from "zod";
import { dbBump, speakable, takeChatToken, verifyReply, visitorId, VOICE_LIMITS } from "@/lib/chat-limits";
import manifest from "@/lib/voice-manifest.json";
import { spoken } from "@/lib/voice-lines";

export const maxDuration = 30;

/** Same model the pre-recorded lines use, so live replies sound like the rest of JC-316. */
const MODEL = "eleven_v3";

const Body = z.object({ text: z.string().min(1).max(4000), sig: z.string().min(10).max(100) });

const fail = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers });

/**
 * Speaks the opening of a JC-316 chat reply with ElevenLabs. Only text signed by /api/chat is
 * accepted (so this can't be used as a general TTS service), only its first two sentences are
 * voiced, and it has its own tighter per-visitor and daily caps (VOICE_LIMITS). Streams MP3.
 */
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (process.env.VOICE_ENABLED === "off" || !key) return fail(503, "Voice comms are offline.");

  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return fail(403, "Wrong channel.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !verifyReply(parsed.data.text, parsed.data.sig)) return fail(400, "Unverified transmission.");

  const grant = await takeChatToken(visitorId(req), new Date(), dbBump, VOICE_LIMITS, "voice:");
  if (!grant.ok) return fail(429, "Voice channel is cooling down.", { "Retry-After": String(grant.retryAfterSec) });

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${manifest.voices.jc316}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: spoken(speakable(parsed.data.text)), model_id: MODEL }),
  });
  if (!res.ok || !res.body) {
    console.warn("voice synthesis failed", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return fail(502, "Voice signal lost.");
  }
  return new Response(res.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Remaining": String(grant.remainingToday) },
  });
}
