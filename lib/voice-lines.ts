import { VOICE, type BriefId, type Speaker } from "./briefings";
import { OWNERS } from "./config";
import type { UnitId } from "./units";

/**
 * Spoken lines for the ElevenLabs voices. Fixed lines (JC-316's lock-on acks and every wingman
 * catchphrase for every symbol it trades) are pre-recorded by scripts/record-voices.ts into
 * public/voice/<clipKey>.mp3, so playing them costs nothing per visitor. Only chat replies are
 * synthesized live (app/api/voice).
 */

/** FNV-1a: a tiny, stable hash so the browser and the recording script agree on clip names. */
export function fnv(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const clipKey = (who: Speaker, text: string) => `${who}-${fnv(text)}`;

/** How tickers should be said aloud (the clip key still uses the text as displayed). */
const SAY: Record<string, string> = {
  "BTC/USD": "Bitcoin",
  "ETH/USD": "Ethereum",
  "SOL/USD": "Solana",
  NVDA: "Nvidia",
  AMZN: "Amazon",
  META: "Meta",
  TSLA: "Tesla",
  AMD: "A M D",
  GOOGL: "Google",
  MSFT: "Microsoft",
  AAPL: "Apple",
  SPY: "S P Y",
  QQQ: "triple-Q",
  "JC-316": "J C three-sixteen",
};
const SAY_RE = new RegExp(
  Object.keys(SAY)
    .sort((a, b) => b.length - a.length)
    .map((k) => `\\b${k.replace(/[/-]/g, (c) => `\\${c}`)}\\b`)
    .join("|"),
  "g",
);

/** Text as it should be spoken: tickers by name, the minus sign as a word. */
export const spoken = (text: string) => text.replace(SAY_RE, (m) => SAY[m] ?? m).replace(/−/g, "minus ");

export const JC_LINES = {
  online: "JC-316 voice channel online, pilot.",
  acks: [
    "Target locked. Here's the read, pilot.",
    "Locked on. Briefing you now.",
    "Scanning. Here's what I see.",
    "On it, pilot. Pulling the data.",
  ],
};

/** Every distinct wingman voice line: each template for each symbol the unit owns. */
export function wingmanLines(): { who: UnitId; text: string }[] {
  const out = new Map<string, { who: UnitId; text: string }>();
  const add = (who: UnitId, text: string) => out.set(`${who}:${text}`, { who, text });
  for (const who of ["spy_core", "sma_cross", "rsi_revert"] as UnitId[]) {
    const symbols = Object.entries(OWNERS)
      .filter(([, u]) => u === who)
      .map(([s]) => s);
    const v = (id: BriefId, c: Record<string, unknown>) => add(who, VOICE[who](id, { unit: who, ...c } as never));
    for (const symbol of symbols) {
      v("position", { symbol });
      v("trade", { symbol, pnlRaw: 1 });
      v("trade", { symbol, pnlRaw: -1 });
      for (const action of ["buy", "sell", "hold"]) v("signal", { symbol, action });
      for (const side of ["buy", "sell"]) v("order", { symbol, side });
    }
    v("unit", {});
    v("sim-unit", {});
    v("equity", {}); // the default line
  }
  return [...out.values()];
}

/** Every pre-recorded clip. */
export function allClips(): { who: Speaker; text: string }[] {
  return [
    { who: "jc316", text: JC_LINES.online },
    ...JC_LINES.acks.map((text) => ({ who: "jc316" as const, text })),
    ...wingmanLines(),
  ];
}

/**
 * Split speech into chunks of whole sentences (≤ max chars) so a long reply can be synthesized in
 * parallel pieces and start playing after the first (short) one. Decimals like $14.66 don't end a sentence.
 * The browser and /api/voice both use this, so a part number means the same text on each side.
 */
export function chunkSpeech(text: string, max = 320, maxChunks = 8, firstMax = 170): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/.+?[.!?]+["”’)]*(?=\s|$)|.+$/g) ?? [];
  const chunks: string[] = [];
  let cur = "";
  for (const raw of sentences) {
    // A runaway sentence gets cut at word boundaries.
    const pieces = raw.length > max ? (raw.match(new RegExp(`.{1,${max}}(?=\\s|$)`, "g")) ?? [raw]) : [raw];
    for (const p of pieces) {
      const s = p.trim();
      // The first chunk is kept short so playback starts sooner.
      if (cur && (cur + " " + s).length > (chunks.length ? max : firstMax)) {
        chunks.push(cur);
        cur = s;
      } else cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.slice(0, maxChunks);
}
