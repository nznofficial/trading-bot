import type { BriefCtx, Speaker } from "./briefings";
import { voiceEnabled } from "./sfx";
import manifest from "./voice-manifest.json";
import { chunkSpeech, clipKey, JC_LINES } from "./voice-lines";

/**
 * Plays the ElevenLabs voices in the browser (only when the VOICE toggle is on). Fixed lines come
 * from pre-recorded clips in public/voice; briefing readings and chat replies are synthesized by
 * /api/voice. Everything plays as one queue: a new line cancels whatever was queued or playing.
 */
const CLIPS = new Set(manifest.clips);
/** Live synthesis requests in flight at once (ElevenLabs limits concurrency per account). */
const PARALLEL = 2;

type Source = string | (() => Promise<string | null>);

let generation = 0;
let current: HTMLAudioElement | null = null;
let aborts: AbortController[] = [];

export function stopVoice() {
  generation++;
  aborts.forEach((a) => a.abort());
  aborts = [];
  current?.pause();
  current = null;
}

function playOne(src: string, gen: number) {
  return new Promise<void>((resolve) => {
    if (gen !== generation) return resolve();
    const a = new Audio(src);
    current = a;
    const done = () => {
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      resolve();
    };
    a.addEventListener("ended", done);
    a.addEventListener("error", done);
    a.addEventListener("pause", done);
    a.play().catch(done); // blocked before a user gesture: stay quiet
  });
}

/** Play sources in order. Live parts are fetched ahead (a couple at a time) while earlier ones play. */
async function queue(sources: Source[]) {
  stopVoice();
  const gen = generation;
  let running = 0;
  const waiters: (() => void)[] = [];
  const slot = async () => {
    while (running >= PARALLEL) await new Promise<void>((r) => waiters.push(r));
    running++;
  };
  const release = () => {
    running--;
    waiters.shift()?.();
  };
  const urls = sources.map(async (s) => {
    if (typeof s === "string") return s;
    await slot();
    try {
      return gen === generation ? await s() : null;
    } finally {
      release();
    }
  });
  for (const u of urls) {
    const src = await u;
    if (gen !== generation) return;
    if (src) await playOne(src, gen);
  }
}

async function synth(body: object): Promise<string | null> {
  const ctrl = new AbortController();
  aborts.push(ctrl);
  try {
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.ok ? URL.createObjectURL(await res.blob()) : null;
  } catch {
    return null; // aborted or offline: the text is already on screen
  }
}

const clip = (who: Speaker, text: string) => {
  const key = clipKey(who, text);
  return CLIPS.has(key) ? `/voice/${key}.mp3` : null;
};

/** Play a pre-recorded line if one exists for exactly this text. Returns whether it played. */
export function sayLine(who: Speaker, text: string, force = false) {
  if (!force && !voiceEnabled()) return false;
  const src = clip(who, text);
  if (src) void queue([src]);
  return !!src;
}

/**
 * Briefing: the speaker's pre-recorded catchphrase (or one of JC-316's lock-on acks), then the
 * "Reading now" line synthesized live in the same voice.
 */
export function sayBriefing(speaker: Speaker, quote: string | null, seq: number, id: string, ctx: BriefCtx) {
  if (!voiceEnabled()) return;
  const opener = quote ? clip(speaker, quote) : clip("jc316", JC_LINES.acks[seq % JC_LINES.acks.length]);
  void queue([...(opener ? [opener] : []), () => synth({ kind: "brief", id, ctx })]);
}

/** Speak a whole chat reply (needs the reply's signature from /api/chat), chunked by sentences. */
export function sayReply(text: string, sig: string) {
  if (!voiceEnabled()) return;
  void queue(chunkSpeech(text).map((_, part) => () => synth({ kind: "reply", text, sig, part })));
}
