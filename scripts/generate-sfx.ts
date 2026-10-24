/**
 * Generate mechanical sound effects with ElevenLabs Sound Effects, compare them with the current
 * synthesized cues, and ship the picks.
 *
 *   npx tsx --env-file=.env.local scripts/generate-sfx.ts                 # 3 options per cue + preview page
 *   npx tsx --env-file=.env.local scripts/generate-sfx.ts --only land     # regenerate one cue
 *   npx tsx --env-file=.env.local scripts/generate-sfx.ts --pick boost=2,land=1
 *   npx tsx --env-file=.env.local scripts/generate-sfx.ts --page [--cues a,b]  # rebuild the page only (no API calls)
 *
 * Options land in art/sfx/raw/ (gitignored) with art/sfx/preview.html. Picks are copied to
 * public/sfx/<cue>.mp3 and listed in lib/sfx-manifest.json; cues without a pick stay synthesized.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSync } from "esbuild";

const API = "https://api.elevenlabs.io/v1";
const KEY = process.env.ELEVENLABS_API_KEY;
const DIR = "art/sfx";
const RAW = join(DIR, "raw");
const OUT = "public/sfx";
const MANIFEST = "lib/sfx-manifest.json";
const OPTIONS = 3;

/** Physical sounds only; UI blips stay synthesized. Durations match the animations they accompany. */
const CUES: Record<string, { seconds: number; prompt: string }> = {
  boost: {
    seconds: 1.6,
    prompt:
      "Giant robot boosting off the ground: a quick hydraulic crouch hiss, then powerful jet thrusters ignite with a deep roar and a fast whoosh. Sci-fi mech, clean, no music, no voice.",
  },
  land: {
    seconds: 1.0,
    prompt:
      "Heavy giant robot landing: one deep metal footstep stomp with a ground impact thud, a metallic clank ringing in a large hangar, then hydraulic pistons settling with a hiss. No music.",
  },
  pickup: {
    seconds: 0.7,
    prompt: "Robot arm servo motor whirring upward, then a mechanical clamp releasing with a click. Sci-fi, close and clean, no music.",
  },
  drop: {
    seconds: 0.7,
    prompt: "Robot servo motor winding down, then a solid metal latch locking into place with a heavy clank. No music.",
  },
  engage: {
    seconds: 0.9,
    prompt:
      "Mechanical latch locking into place inside a robot cockpit: a short servo whir, a heavy metal clunk, then a crisp two-tone electronic confirmation beep. No music.",
  },
  win: {
    seconds: 2.2,
    prompt:
      "Sci-fi mech reactor powering up to full: a rising energy hum and turbine whine building into a triumphant heavy power surge with a bright metallic shimmer. No music, no voice.",
  },
  "comms-open": {
    seconds: 0.7,
    prompt:
      "Military radio channel opening inside a robot cockpit: a key click, a short squelch burst opening up, then a crisp rising two-note electronic chirp. No music, no voice.",
  },
  "comms-close": {
    seconds: 1.0,
    prompt:
      "Military radio transmission ending: a squelch tail cutting off, a brief burst of fading static, then a short descending two-tone sign-off beep. Sci-fi cockpit, no music, no voice.",
  },
  powerdown: {
    seconds: 1.4,
    prompt:
      "Giant robot powering down to standby: a turbine whine spinning down in pitch, servos retracting, then a heavy mechanical relay clunk and a soft hydraulic sigh. No music.",
  },
  powerup: {
    seconds: 1.2,
    prompt:
      "Giant robot powering back up from standby: a relay click, a turbine whine spinning up in pitch, servos unfolding, then a short bright ready chirp. No music.",
  },
  "brief-close": {
    seconds: 0.6,
    prompt: "Sci-fi targeting lock releasing: two quick descending electronic chirps and a soft click. Clean, no music.",
  },
  launch: {
    seconds: 2.6,
    prompt:
      "Electromagnetic catapult launch for a giant robot: a rising electric charging whine, a loud release clamp slam, then a thruster roar as it rockets away. No music.",
  },
};

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function generate(text: string, seconds: number) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/sound-generation?output_format=mp3_44100_96`, {
      method: "POST",
      headers: { "xi-api-key": KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({ text, duration_seconds: seconds, prompt_influence: 0.5, model_id: "eleven_text_to_sound_v3" }),
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`sound-generation ${res.status} ${body.slice(0, 300)}`);
  }
}

async function run(only?: string) {
  if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set (add it to .env.local)");
  mkdirSync(RAW, { recursive: true });
  for (const [cue, c] of Object.entries(CUES)) {
    if (only && cue !== only) continue;
    process.stdout.write(`${cue}: `);
    await Promise.all(
      Array.from({ length: OPTIONS }, async (_, i) => {
        writeFileSync(join(RAW, `${cue}-${i + 1}.mp3`), await generate(c.prompt, c.seconds));
        process.stdout.write(`${i + 1} `);
      }),
    );
    console.log();
  }
  writePage();
}

function pick(spec: string) {
  mkdirSync(OUT, { recursive: true });
  const manifest: { cues: string[] } = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : { cues: [] };
  for (const part of spec.split(",")) {
    const [cue, n] = part.split("=");
    if (!CUES[cue]) throw new Error(`unknown cue ${cue}`);
    if (n === "synth") {
      manifest.cues = manifest.cues.filter((c) => c !== cue);
      continue;
    }
    copyFileSync(join(RAW, `${cue}-${n}.mp3`), join(OUT, `${cue}.mp3`));
    if (!manifest.cues.includes(cue)) manifest.cues.push(cue);
    console.log(`${cue} ← option ${n}`);
  }
  manifest.cues.sort();
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
}

/** Preview page: each option next to the current synthesized cue (bundled from lib/sfx.ts). */
function writePage(only?: string[]) {
  const synth = buildSync({
    entryPoints: ["lib/sfx.ts"],
    bundle: true,
    format: "iife",
    globalName: "SFX",
    write: false,
    target: "es2020",
  }).outputFiles[0].text;
  const rows = Object.entries(CUES)
    .filter(([cue]) => !only || only.includes(cue))
    .map(
      ([cue, c]) => `<h2>${cue} <small>${c.seconds}s</small></h2><p class="d">${c.prompt}</p><div class="row">
      <button data-synth="${cue}">▶ Current (synth)</button>
      ${Array.from({ length: OPTIONS }, (_, i) => `<button data-src="raw/${cue}-${i + 1}.mp3">▶ Option ${i + 1}</button>`).join("")}</div>`,
    )
    .join("");
  writeFileSync(
    join(DIR, "preview.html"),
    `<!doctype html><meta charset="utf-8"><title>MMC sound effects</title>
<style>body{background:#0e0d14;color:#e9e6f2;font:15px system-ui;margin:32px;max-width:980px}h2{color:#ffa41b;margin:26px 0 4px}h2 small{color:#9a95ad;font-weight:400}
.d{color:#9a95ad;margin:0 0 10px}.row{display:flex;gap:10px;flex-wrap:wrap}
button{background:#1c1927;color:#e9e6f2;border:1px solid #4a4466;padding:8px 12px;cursor:pointer}button:hover{border-color:#ffa41b}button[data-synth]{border-style:dashed}</style>
<h1>Mobile Market Corps · sound effects</h1><p>Compare each option with the current synthesized sound, then tell Claude your picks (e.g. boost=2, land=1, pickup=synth).</p>
${rows}
<script>${synth}
let cur;
document.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  cur?.pause();
  if (b.dataset.synth) SFX.play(b.dataset.synth, true);
  else { cur = new Audio(b.dataset.src); cur.play(); }
});
</script>`,
  );
  console.log(`preview page: ${join(DIR, "preview.html")}`);
}

async function main() {
  const spec = arg("pick");
  if (args.includes("--page")) writePage(arg("cues")?.split(","));
  else if (spec) pick(spec);
  else await run(arg("only"));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
