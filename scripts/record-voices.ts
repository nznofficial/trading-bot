/**
 * Pre-record every fixed voice line (lib/voice-lines.ts) with the saved ElevenLabs voices.
 *
 *   npx tsx --env-file=.env.local scripts/record-voices.ts           # record missing clips
 *   npx tsx --env-file=.env.local scripts/record-voices.ts --dry     # list what would be recorded
 *
 * Writes public/voice/<clipKey>.mp3 and lib/voice-manifest.json (the clip list the browser checks
 * before fetching). Existing clips are skipped, so re-running after a template change only records
 * the new lines.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { allClips, clipKey, spoken } from "../lib/voice-lines";

const API = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY;
const OUT = "public/voice";
const MANIFEST = "lib/voice-manifest.json";
/** The designed voices were made with the v3 voice model; v3 speech matches them best. */
const MODEL = "eleven_v3";
const FORMAT = "mp3_44100_64";

const saved = JSON.parse(readFileSync("art/voices/voices.json", "utf8")) as Record<string, { voiceId: string } | undefined>;
const VOICE_IDS: Record<string, string | undefined> = {
  jc316: saved.jc316?.voiceId,
  sma_cross: saved.vanguard?.voiceId,
  rsi_revert: saved.recoil?.voiceId,
  spy_core: saved.bastion?.voiceId,
  news_drift: saved.herald?.voiceId,
};

async function tts(voiceId: string, text: string) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/text-to-speech/${voiceId}?output_format=${FORMAT}`, {
      method: "POST",
      headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: MODEL }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`tts ${res.status} ${body.slice(0, 300)}`);
  }
}

async function main() {
  const dry = process.argv.includes("--dry");
  if (!dry && !KEY) throw new Error("ELEVENLABS_API_KEY is not set (add it to .env.local)");
  mkdirSync(OUT, { recursive: true });
  const clips = allClips();
  const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
  // Speakers without a picked voice yet (scripts/design-voices.ts) are skipped; their lines use the synth cue.
  const unvoiced = [...new Set(clips.filter((c) => !VOICE_IDS[c.who]).map((c) => c.who))];
  if (unvoiced.length) console.log(`no voice picked yet for: ${unvoiced.join(", ")} (skipping their lines)`);
  const todo = clips.filter((c) => VOICE_IDS[c.who] && !existsSync(join(OUT, `${clipKey(c.who, c.text)}.mp3`)));
  todo.splice(limit);
  const chars = todo.reduce((a, c) => a + c.text.length, 0);
  console.log(`${clips.length} clips, ${todo.length} to record (${chars} characters)`);
  if (dry) {
    for (const c of todo) console.log(`  ${c.who}: ${c.text}`);
    return;
  }
  // A few at a time: fast, but well under the API's concurrency limit.
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(
      todo.slice(i, i + 3).map(async (c) => {
        writeFileSync(join(OUT, `${clipKey(c.who, c.text)}.mp3`), await tts(VOICE_IDS[c.who]!, spoken(c.text)));
      }),
    );
    process.stdout.write(`\r  ${Math.min(i + 3, todo.length)}/${todo.length}`);
  }
  console.log();
  const keys = clips.map((c) => clipKey(c.who, c.text)).filter((k) => existsSync(join(OUT, `${k}.mp3`)));
  writeFileSync(MANIFEST, JSON.stringify({ voices: VOICE_IDS, clips: [...new Set(keys)].sort() }, null, 2) + "\n");
  console.log(`manifest: ${MANIFEST} (${keys.length} clips)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
