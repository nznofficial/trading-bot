import { z } from "zod";
import { briefing, isBriefId, type BriefCtx } from "@/lib/briefings";
import { dbBump, takeVoiceBudget, verifyReply, visitorId } from "@/lib/chat-limits";
import manifest from "@/lib/voice-manifest.json";
import { chunkSpeech, spoken } from "@/lib/voice-lines";

export const maxDuration = 30;

/** Same model the pre-recorded lines use, so live speech sounds like the rest of the cast. */
const MODEL = "eleven_v3";
const VOICES: Record<string, string> = manifest.voices;

const Reply = z.object({
  kind: z.literal("reply"),
  text: z.string().min(1).max(6000),
  sig: z.string().min(10).max(100),
  part: z.number().int().min(0).max(7),
});
const Brief = z.object({ kind: z.literal("brief"), id: z.string().max(40), ctx: z.record(z.string().max(30), z.unknown()) });

/**
 * Briefing values are short labels and formatted numbers. Anything longer or with unexpected
 * characters is dropped (the template then reads "—"), which keeps free text out of the voice.
 */
const SAFE = /^[\w\s$%.,:;/+\-−—–()#'&·→<>=!?"“”]*$/;
function cleanCtx(ctx: Record<string, unknown>): BriefCtx {
  const out: BriefCtx = {};
  for (const [k, v] of Object.entries(ctx).slice(0, 24)) {
    if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string" && v.length <= 120 && SAFE.test(v)) out[k] = v;
  }
  return out;
}
const Body = z.discriminatedUnion("kind", [Reply, Brief]);

const fail = (status: number, error: string, headers?: Record<string, string>) =>
  Response.json({ error }, { status, headers });

/**
 * Live speech (ElevenLabs), for two things only, so this can't be used as a general TTS service:
 * - a part of a JC-316 chat reply, which must carry /api/chat's signature over the full text;
 * - a briefing's "Reading now" line, which the server rebuilds from the briefing template and the
 *   panel's (format-checked) values, in the voice of whoever owns that panel.
 * Billed per character, so every request draws on the character budget in lib/chat-limits.ts.
 */
export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (process.env.VOICE_ENABLED === "off" || !key) return fail(503, "Voice comms are offline.");

  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return fail(403, "Wrong channel.");

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(400, "Transmission garbled.");
  const b = parsed.data;

  let text: string;
  let who = "jc316";
  if (b.kind === "reply") {
    if (!verifyReply(b.text, b.sig)) return fail(400, "Unverified transmission.");
    const part = chunkSpeech(b.text)[b.part];
    if (!part) return fail(400, "No such part.");
    text = part;
  } else {
    if (!isBriefId(b.id)) return fail(400, "Unknown panel.");
    const br = briefing(b.id, cleanCtx(b.ctx))!;
    text = br.now.slice(0, 400);
    who = br.speaker;
  }

  const grant = await takeVoiceBudget(visitorId(req), text.length, new Date(), dbBump);
  if (!grant.ok) return fail(429, "Voice channel is cooling down.", { "Retry-After": String(grant.retryAfterSec) });

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[who]}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: spoken(text), model_id: MODEL }),
  });
  if (!res.ok || !res.body) {
    console.warn("voice synthesis failed", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return fail(502, "Voice signal lost.");
  }
  return new Response(res.body, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Remaining": String(grant.remainingToday) },
  });
}
