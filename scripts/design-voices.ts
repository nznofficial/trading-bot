/**
 * Design the mech voices with ElevenLabs Voice Design, and save the one the pilot picks.
 *
 *   npx tsx --env-file=.env.local scripts/design-voices.ts            # generate previews + preview page
 *   npx tsx --env-file=.env.local scripts/design-voices.ts --only recoil
 *   npx tsx --env-file=.env.local scripts/design-voices.ts --pick jc316=2,vanguard=1,recoil=3
 *   npx tsx --env-file=.env.local scripts/design-voices.ts --page       # rebuild the page only (no API calls)
 *
 * Previews land in art/voices/raw/ (gitignored) with art/voices/preview.html to listen to them
 * (serve it, e.g. `python3 -m http.server 8765 -d art/voices`; opened as a file it can't load audio),
 * raw and through the in-app comms effects. Picking saves the voice to the ElevenLabs account and
 * records its id in art/voices/voices.json. The key is read from the environment, never written.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VOICE_FX_SOURCE } from "../lib/voice-fx";

const API = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set (add it to .env.local)");

const DIR = "art/voices";
const RAW = join(DIR, "raw");
const LOG = join(DIR, "previews.json");
const VOICES = join(DIR, "voices.json");

type Speaker = "jc316" | "vanguard" | "recoil" | "bastion";

/** Original characters: described by sound, never by reference to existing franchises or actors. */
const SPEAKERS: Record<Speaker, { name: string; description: string; text: string }> = {
  jc316: {
    name: "JC-316",
    description:
      "A calm, low, measured male voice for a veteran AI copilot inside a giant combat robot. Steady and protective with a dry wit, precise diction, slightly gravelly, around forty-five, neutral American accent. Sounds like a seasoned flight controller speaking over a cockpit radio.",
    text: "JC-316 online. Welcome to the Corps, pilot. Equity is holding steady, two engagements are open, and every stop is armed. I'll keep watch on the board while you work.",
  },
  vanguard: {
    name: "Vanguard",
    description:
      "A brash, fast-talking, confident young male combat pilot. Energetic and cocky but sharp, a bright edge to the tone, quick tempo, American accent. An ace about to launch who can't wait to get into the fight.",
    text: "Vanguard here! Crossover confirmed on NVDA, the trend is lining up and I'm itching to move. Give me clearance, pilot, and I'll ride this one all the way up.",
  },
  recoil: {
    name: "Recoil",
    description:
      "A deep, slow, gravelly voice of a heavy-artillery soldier. Patient and unflappable with a quiet menace, low resonant bass, few words and deliberate pauses, weathered and calm under fire.",
    text: "Recoil reporting. When the market panics, I wait. MSFT is oversold. I'm moving in slow and steady, and when the bounce comes, I sell.",
  },
  bastion: {
    name: "Bastion",
    description:
      "A very deep, warm, resonant older male voice for the fortress commander of a giant defensive robot. Slow, unhurried and completely composed, smooth rather than gravelly, with quiet authority and certainty. Speaks in few words, like a last line of defense who never raises his voice. Neutral American accent.",
    text: "Bastion, holding the line. The market is above its two-hundred-day average, so I stand my ground. When the line breaks, I fall back, and I wait.",
  },
};

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function api(path: string, body: unknown) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 409 || res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`${path} → ${res.status} ${text.slice(0, 400)}`);
  }
}

type Preview = { speaker: Speaker; n: number; file: string; generatedVoiceId: string; seconds: number };

async function design(only?: Speaker) {
  mkdirSync(RAW, { recursive: true });
  const log: Preview[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];
  for (const speaker of Object.keys(SPEAKERS) as Speaker[]) {
    if (only && speaker !== only) continue;
    const s = SPEAKERS[speaker];
    console.log(`designing ${s.name}…`);
    const out = await api("/text-to-voice/design", {
      voice_description: s.description,
      text: s.text,
      model_id: "eleven_ttv_v3",
    });
    const kept = log.filter((p) => p.speaker !== speaker);
    out.previews.forEach((p: { audio_base_64: string; generated_voice_id: string; duration_secs: number }, i: number) => {
      const file = join(RAW, `${speaker}-${i + 1}.mp3`);
      writeFileSync(file, Buffer.from(p.audio_base_64, "base64"));
      kept.push({ speaker, n: i + 1, file, generatedVoiceId: p.generated_voice_id, seconds: p.duration_secs });
    });
    log.length = 0;
    log.push(...kept);
    console.log(`  ${out.previews.length} previews`);
  }
  writeFileSync(LOG, JSON.stringify(log, null, 2));
  writePreviewPage(log);
}

async function pick(spec: string) {
  const log: Preview[] = JSON.parse(readFileSync(LOG, "utf8"));
  const saved: Partial<Record<Speaker, { voiceId: string; preview: number }>> = existsSync(VOICES)
    ? JSON.parse(readFileSync(VOICES, "utf8"))
    : {};
  for (const part of spec.split(",")) {
    const [speaker, n] = part.split("=") as [Speaker, string];
    const p = log.find((x) => x.speaker === speaker && x.n === Number(n));
    if (!p) throw new Error(`no preview ${part}`);
    const s = SPEAKERS[speaker];
    const res = await api("/text-to-voice", {
      voice_name: `MMC ${s.name}`,
      voice_description: s.description,
      generated_voice_id: p.generatedVoiceId,
      labels: { app: "mobile-market-corps", speaker },
    });
    saved[speaker] = { voiceId: res.voice_id, preview: p.n };
    console.log(`saved ${s.name} → ${res.voice_id}`);
  }
  writeFileSync(VOICES, JSON.stringify(saved, null, 2) + "\n");
}

function writePreviewPage(log: Preview[]) {
  const rows = (Object.keys(SPEAKERS) as Speaker[])
    .map((sp) => {
      const items = log
        .filter((p) => p.speaker === sp)
        .map(
          (p) => `<div class="card"><b>${SPEAKERS[sp].name} · option ${p.n}</b><span>${p.seconds.toFixed(1)}s</span>
          <button data-src="raw/${sp}-${p.n}.mp3" data-who="${sp}" data-fx="0">▶ Raw</button>
          <button data-src="raw/${sp}-${p.n}.mp3" data-who="${sp}" data-fx="1">▶ Mech comms</button></div>`,
        )
        .join("");
      return `<h2>${SPEAKERS[sp].name}</h2><p class="d">${SPEAKERS[sp].description}</p><p class="t">“${SPEAKERS[sp].text}”</p><div class="row">${items}</div>`;
    })
    .join("");
  writeFileSync(
    join(DIR, "preview.html"),
    `<!doctype html><meta charset="utf-8"><title>MMC voice previews</title>
<style>body{background:#0e0d14;color:#e9e6f2;font:15px system-ui;margin:32px;max-width:980px}h2{color:#ffa41b;margin:28px 0 4px}
.d{color:#9a95ad;margin:0}.t{color:#cfcbe0;font-style:italic}.row{display:flex;gap:12px;flex-wrap:wrap}
.card{border:1px solid #3a3550;padding:12px;display:grid;gap:8px;min-width:220px}.card span{color:#9a95ad;font-size:12px}
button{background:#1c1927;color:#e9e6f2;border:1px solid #4a4466;padding:6px 10px;cursor:pointer}button:hover{border-color:#ffa41b}</style>
<h1>Mobile Market Corps · voice previews</h1><p>Listen to each option raw and through the in-app mech comms effect, then tell Claude your picks (e.g. jc316=2, vanguard=1, recoil=3).</p>
${rows}
<script>${VOICE_FX_SOURCE}
let ctx, cur;
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  ctx ??= new AudioContext(); cur?.stop();
  const buf = await ctx.decodeAudioData(await (await fetch(b.dataset.src)).arrayBuffer());
  cur = playVoice(ctx, buf, b.dataset.who, b.dataset.fx === "1");
});
</script>`,
  );
  // Browsers block fetch() from file:// pages, so the buttons only work when the folder is served.
  console.log(`preview page: python3 -m http.server 8765 -d ${DIR} → http://localhost:8765/preview.html`);
}

async function main() {
  const pickSpec = arg("pick");
  if (args.includes("--page")) writePreviewPage(JSON.parse(readFileSync(LOG, "utf8")));
  else if (pickSpec) await pick(pickSpec);
  else await design(arg("only") as Speaker | undefined);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
