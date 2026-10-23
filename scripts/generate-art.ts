/**
 * Generate the mecha art pack with OpenAI image models.
 *
 *   npx tsx --env-file=.env.art scripts/generate-art.ts --phase A          # anchor sheets (3 options each)
 *   npx tsx --env-file=.env.art scripts/generate-art.ts --pick jc316-sheet=2
 *   npx tsx --env-file=.env.art scripts/generate-art.ts --phase B          # uses picked anchors as references
 *   npx tsx --env-file=.env.art scripts/generate-art.ts --only jc316-bust-victory --reroll
 *
 * Options: --n <count>  --draft (low quality)  --reroll (add more options)  --force (repick over a pick)
 * Outputs: art/raw/<id>-<n>.webp (all options), public/art/<id>.webp (picked), art/contact.html, art/log.json.
 * The API key (OPENAI_API_KEY) is read from the environment and never written anywhere.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { join } from "node:path";
import { ASSETS, type Asset } from "../art/manifest";
import { CHARACTERS, STYLE } from "../art/style";

const ROOT = join(import.meta.dirname, "..");
const RAW = join(ROOT, "art/raw");
const PICKED = join(ROOT, "public/art");
/** Approved model sheets: full resolution, used only as generation references (never served). */
const ANCHORS = join(ROOT, "art/anchors");
const LOG = join(ROOT, "art/log.json");
const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
const API = "https://api.openai.com/v1";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const sheetOf = (c: string) => join(ANCHORS, `${c}-sheet.webp`);

/** Served width per asset kind; picks are resized and re-encoded so the site stays light. */
const servedWidth = (a: Asset) => (a.id.includes("-bust-") || a.id.endsWith("-bust") ? 512 : a.id.includes("keyart") ? 800 : a.id.startsWith("empty-") ? 512 : 1920);
/** Option files for an asset: exactly "<id>-<n>.webp" (ids are [a-z0-9-], so no regex escaping needed). */
const rawFiles = (id: string) =>
  existsSync(RAW) ? readdirSync(RAW).filter((f) => new RegExp(`^${id}-\\d+\\.webp$`).test(f)) : [];

export function promptFor(a: Asset) {
  const who = a.characters.map((c) => CHARACTERS[c]).join("\n\n");
  return [STYLE, who, a.scene].filter(Boolean).join("\n\n");
}

type LogEntry = { id: string; file: string; model: string; size: string; quality: string; background: string; refs: string[]; prompt: string; at: string; usage?: unknown };
const log: LogEntry[] = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf8")) : [];

async function call(path: string, init: RequestInit): Promise<{ data: { b64_json: string }[]; usage?: unknown }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set (put it in .env.art and pass --env-file=.env.art)");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, ...init.headers } });
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 2000 * (attempt + 1);
      console.warn(`  ${res.status}, retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw Object.assign(new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`), { status: res.status, body: text });
  }
}

async function generateOne(a: Asset, n: number, quality: string) {
  const refs = a.phase === "A" ? [] : a.characters.map(sheetOf);
  const missing = refs.filter((r) => !existsSync(r));
  if (missing.length) throw new Error(`${a.id}: pick the anchor sheets first (missing ${missing.map((m) => m.split("/").pop()).join(", ")})`);

  const run = async (background: "transparent" | "opaque" | "auto", extra = "") => {
    const prompt = promptFor(a) + extra;
    if (!refs.length) {
      return {
        prompt,
        background,
        res: await call("/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: MODEL, prompt, size: a.size, quality, n, output_format: "webp", background }),
        }),
      };
    }
    const form = new FormData();
    form.set("model", MODEL);
    form.set("prompt", prompt);
    form.set("size", a.size);
    form.set("quality", quality);
    form.set("n", String(n));
    form.set("output_format", "webp");
    form.set("background", background);
    for (const r of refs) form.append("image[]", new Blob([readFileSync(r)], { type: "image/webp" }), r.split("/").pop());
    return { prompt, background, res: await call("/images/edits", { method: "POST", body: form }) };
  };

  let out;
  try {
    out = await run(a.transparent ? "transparent" : "auto");
  } catch (e) {
    // Transparency is a preview feature on some models; fall back to the panel color.
    if (a.transparent && /background|transparent/i.test((e as { body?: string }).body ?? "")) {
      console.warn(`  transparent background rejected; using opaque #0E0D14`);
      out = await run("opaque", "\n\nPlain solid flat deep-shadow #0E0D14 background behind the character.");
    } else throw e;
  }

  mkdirSync(RAW, { recursive: true });
  const existing = rawFiles(a.id).length;
  const files: string[] = [];
  out.res.data.forEach((d, i) => {
    const file = join(RAW, `${a.id}-${existing + i + 1}.webp`);
    writeFileSync(file, Buffer.from(d.b64_json, "base64"));
    files.push(file);
    log.push({
      id: a.id,
      file: file.replace(ROOT + "/", ""),
      model: MODEL,
      size: a.size,
      quality,
      background: out.background,
      refs: refs.map((r) => r.replace(ROOT + "/", "")),
      prompt: out.prompt,
      at: new Date().toISOString(),
      usage: out.res.usage,
    });
  });
  writeFileSync(LOG, JSON.stringify(log, null, 2));
  return files;
}

async function pick(spec: string) {
  const [id, n] = spec.split("=");
  const asset = ASSETS.find((a) => a.id === id);
  if (!asset) throw new Error(`unknown asset: ${id}`);
  const src = join(RAW, `${id}-${n}.webp`);
  if (!existsSync(src)) throw new Error(`no such option: ${src}`);
  const anchor = asset.phase === "A";
  const dest = join(anchor ? ANCHORS : PICKED, `${id}.webp`);
  if (existsSync(dest) && !flag("force")) throw new Error(`${id} is already picked; pass --force to replace it`);
  mkdirSync(anchor ? ANCHORS : PICKED, { recursive: true });
  if (anchor) {
    copyFileSync(src, dest); // references keep full resolution
  } else {
    // Keep alpha for transparent busts; quality 82 is visually lossless for cel art at these sizes.
    await sharp(src).resize({ width: servedWidth(asset), withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toFile(dest);
  }
  console.log(`picked ${id} ← option ${n} → ${dest.replace(ROOT + "/", "")} (${Math.round(statSync(dest).size / 1024)} KB)`);
}

/** A local HTML page with every option, labeled, for review (and the picked one highlighted). */
function contactSheet() {
  const groups = ASSETS.map((a) => {
    const opts = rawFiles(a.id)
      .sort((x, y) => Number(x.match(/-(\d+)\.webp$/)![1]) - Number(y.match(/-(\d+)\.webp$/)![1]));
    if (!opts.length) return "";
    const picked = existsSync(join(a.phase === "A" ? ANCHORS : PICKED, `${a.id}.webp`));
    return `<section><h2>${a.id} <small>${a.size} · ${a.usedIn}${picked ? " · ✔ picked" : ""}</small></h2><div class="row">${opts
      .map((f) => `<figure><img src="raw/${f}" loading="lazy"><figcaption>option ${f.match(/-(\d+)\.webp$/)![1]}</figcaption></figure>`)
      .join("")}</div></section>`;
  }).join("");
  writeFileSync(
    join(ROOT, "art/contact.html"),
    `<!doctype html><meta charset="utf-8"><title>JC-316 art contact sheet</title><style>
body{background:#0e0d14;color:#ece8f4;font:14px system-ui;margin:24px}h2{font-size:16px;margin:28px 0 8px}small{color:#7d7392;font-weight:400}
.row{display:flex;gap:12px;flex-wrap:wrap}figure{margin:0;background:repeating-conic-gradient(#1c1927 0 25%,#15131e 0 50%) 0/20px 20px}
img{display:block;max-height:340px;max-width:100%}figcaption{padding:4px 8px;color:#ffa41b}</style><h1>JC-316 art · contact sheet</h1>${groups}`,
  );
  console.log("contact sheet → art/contact.html");
}

async function main() {
  if (value("pick")) {
    for (const p of value("pick")!.split(",")) await pick(p);
    contactSheet();
    return;
  }
  if (flag("sheet")) return contactSheet();

  const only = value("only")?.split(",");
  const phase = value("phase");
  const targets = ASSETS.filter((a) => (only ? only.includes(a.id) : phase ? a.phase === phase : false));
  if (!targets.length) {
    console.log("Nothing selected. Use --phase A|B|C|D, --only <id,...>, --pick <id=n>, or --sheet.");
    console.log(ASSETS.map((a) => `  ${a.phase}  ${a.id.padEnd(22)} ${a.size.padEnd(10)} ${a.usedIn}`).join("\n"));
    return;
  }
  const quality = flag("draft") ? "low" : (process.env.OPENAI_IMAGE_QUALITY ?? "high");
  console.log(`model ${MODEL} · quality ${quality} · ${targets.length} asset(s)`);
  for (const a of targets) {
    if (rawFiles(a.id).length && !flag("reroll")) {
      console.log(`skip ${a.id} (has options; --reroll to add more)`);
      continue;
    }
    const n = Number(value("n") ?? (a.phase === "A" ? 3 : 1));
    process.stdout.write(`${a.id} ×${n} … `);
    const t = Date.now();
    const files = await generateOne(a, n, quality);
    console.log(`${files.length} in ${((Date.now() - t) / 1000).toFixed(0)}s`);
  }
  contactSheet();
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
