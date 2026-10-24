import type { Speaker } from "./briefings";
import { voiceEnabled } from "./sfx";
import manifest from "./voice-manifest.json";
import { clipKey, JC_LINES } from "./voice-lines";

/**
 * Plays the ElevenLabs voices in the browser (only when the VOICE toggle is on). Fixed lines come
 * from pre-recorded clips in public/voice; chat replies are fetched from /api/voice. One line at a
 * time: a new line cuts off the previous one.
 */
const CLIPS = new Set(manifest.clips);
let current: HTMLAudioElement | null = null;
let pending: AbortController | null = null;

function play(src: string) {
  stopVoice();
  const a = new Audio(src);
  current = a;
  a.play().catch(() => {}); // blocked before a user gesture: stay quiet
  a.addEventListener("ended", () => {
    if (src.startsWith("blob:")) URL.revokeObjectURL(src);
  });
}

export function stopVoice() {
  pending?.abort();
  pending = null;
  current?.pause();
  current = null;
}

/** Play a pre-recorded line if one exists for exactly this text. Returns whether it played. */
export function sayLine(who: Speaker, text: string, force = false) {
  if (!force && !voiceEnabled()) return false;
  const key = clipKey(who, text);
  if (!CLIPS.has(key)) return false;
  play(`/voice/${key}.mp3`);
  return true;
}

/** Briefing voice: the wingman's catchphrase, or one of JC-316's lock-on acknowledgements. */
export function sayBriefing(speaker: Speaker, quote: string | null, seq: number) {
  if (quote) sayLine(speaker, quote);
  else sayLine("jc316", JC_LINES.acks[seq % JC_LINES.acks.length]);
}

/** Speak the opening of a chat reply (server-synthesized; needs the reply's signature from /api/chat). */
export async function sayReply(text: string, sig: string) {
  if (!voiceEnabled()) return;
  stopVoice();
  const ctrl = new AbortController();
  pending = ctrl;
  try {
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, sig }),
      signal: ctrl.signal,
    });
    if (!res.ok || ctrl.signal.aborted) return;
    const url = URL.createObjectURL(await res.blob());
    if (!ctrl.signal.aborted) play(url);
  } catch {
    // Aborted or offline: no voice, the text is already on screen.
  }
}
