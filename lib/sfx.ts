/**
 * Cockpit sound design, synthesized live with Web Audio (no audio files). Every cue is built from a
 * few layered parts: servo whine (filtered saw with vibrato), hydraulics (band-passed noise), metal
 * (inharmonic FM partials through a small "hangar" reverb), thrusters (swept noise + sub rumble) and
 * comms (band-limited squelch and data blips). Off by default; the header toggle stores the choice
 * per browser. Browsers only allow audio after a user gesture, so cues before one are skipped.
 * Spoken lines are separate: see lib/voice-player.ts.
 */
import sfxManifest from "./sfx-manifest.json";

export type Cue =
  | "click"
  | "engage"
  | "win"
  | "complete"
  | "boost"
  | "land"
  | "lock"
  | "pickup"
  | "drop"
  | "squelch"
  | "chatter"
  | "launch"
  | "comms-open"
  | "comms-close"
  | "powerdown"
  | "powerup"
  | "brief-close"
  | "voice-jc316"
  | "voice-sma_cross"
  | "voice-rsi_revert";

const KEY = "pt-sound";

export function soundEnabled() {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the toggle still works for this page view.
  }
  window.dispatchEvent(new Event("pt-sound"));
}

// ── Engine ──────────────────────────────────────────────────────────────────────────────────
type Bus = { ctx: AudioContext; out: GainNode; verb: GainNode; noise: AudioBuffer; crunch: WaveShaperNode };
let bus: Bus | null = null;

function engine(): Bus {
  if (bus) return bus;
  const ctx = new AudioContext();
  // Master: a soft-clip limiter, so stacked layers saturate gently instead of clipping. (A
  // DynamicsCompressor's automatic makeup gain made transients spike unpredictably.)
  const limiter = ctx.createWaveShaper();
  const lc = new Float32Array(2048);
  for (let i = 0; i < 2048; i++) lc[i] = Math.tanh(((i / 2047) * 2 - 1) * 1.5) / Math.tanh(1.5);
  limiter.curve = lc;
  limiter.connect(ctx.destination);
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(limiter);

  // Hangar reverb: a short, bright decaying-noise impulse (metal bay, not a cathedral).
  const len = Math.floor(ctx.sampleRate * 1.1);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    // 20ms fade-in so transients don't spike through the reverb; then a fast metallic decay.
    const fade = ctx.sampleRate * 0.02;
    // Seeded noise: the same hangar every time, so cue levels don't vary run to run.
    let seed = 316 + ch;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, 3.2) * Math.min(1, i / fade);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  const verb = ctx.createGain();
  verb.gain.value = 0.28;
  verb.connect(conv).connect(out);

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // Soft-clip curve for gritty mechanical layers.
  const crunch = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * 3);
  }
  crunch.curve = curve;
  // Signals are driven hard into the curve (see phrase) and trimmed back down after it.
  const trim = ctx.createGain();
  trim.gain.value = 0.1;
  crunch.connect(trim).connect(out);

  bus = { ctx, out, verb, noise, crunch };
  return bus;
}

type Env = { at: number; dur: number; gain: number; attack?: number; wet?: number; dest?: AudioNode };

/** Gain envelope routed to the dry bus plus an optional reverb send. */
function envelope(b: Bus, { at, dur, gain, attack = 0.005, wet = 0, dest }: Env) {
  const g = b.ctx.createGain();
  // Start silent: a GainNode defaults to 1, and the first sample can render before the automation
  // kicks in, which came out as a one-sample click.
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  g.connect(dest ?? b.out);
  if (wet > 0) {
    const s = b.ctx.createGain();
    s.gain.value = wet;
    g.connect(s).connect(b.verb);
  }
  return g;
}

function tone(
  b: Bus,
  o: Env & { freq: number; type?: OscillatorType; slideTo?: number; vibrato?: [rate: number, depth: number] },
) {
  const osc = b.ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, o.at);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, o.at + o.dur);
  if (o.vibrato) {
    const lfo = b.ctx.createOscillator();
    const depth = b.ctx.createGain();
    lfo.frequency.value = o.vibrato[0];
    depth.gain.value = o.vibrato[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(o.at);
    lfo.stop(o.at + o.dur + 0.05);
  }
  osc.connect(envelope(b, o));
  osc.start(o.at);
  osc.stop(o.at + o.dur + 0.05);
  return osc;
}

function noise(
  b: Bus,
  o: Env & { filter?: BiquadFilterType; freq: number; q?: number; sweepTo?: number },
) {
  const src = b.ctx.createBufferSource();
  src.buffer = b.noise;
  src.loop = true;
  const f = b.ctx.createBiquadFilter();
  f.type = o.filter ?? "bandpass";
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.freq, o.at);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, o.at + o.dur);
  src.connect(f).connect(envelope(b, o));
  src.start(o.at, Math.random());
  src.stop(o.at + o.dur + 0.05);
}

/** Struck metal: inharmonic partials (FM-style ratios) that ring into the reverb. */
function metal(b: Bus, at: number, base: number, gain: number, ring = 0.6) {
  [1, 2.76, 5.4, 8.93].forEach((r, i) =>
    tone(b, { at, dur: ring / (i + 1), gain: gain / (i + 1.5), freq: base * r, type: "sine", wet: 0.6, attack: 0.002 }),
  );
  noise(b, { at, dur: 0.05, gain: gain * 0.8, freq: 3500, q: 0.7, filter: "highpass" });
}

/** Servo: a buzzy saw through a resonant band-pass that glides, with mechanical vibrato. */
function servo(b: Bus, at: number, dur: number, from: number, to: number, gain = 0.05) {
  const osc = b.ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  const lfo = b.ctx.createOscillator();
  const depth = b.ctx.createGain();
  lfo.frequency.value = 38;
  depth.gain.value = from * 0.04;
  lfo.connect(depth).connect(osc.frequency);
  const bp = b.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 6;
  bp.frequency.setValueAtTime(from * 3, at);
  bp.frequency.exponentialRampToValueAtTime(to * 3, at + dur);
  osc.connect(bp).connect(envelope(b, { at, dur, gain, attack: 0.03, wet: 0.2 }));
  lfo.start(at);
  osc.start(at);
  osc.stop(at + dur + 0.05);
  lfo.stop(at + dur + 0.05);
}

/** Pneumatic release. */
const hiss = (b: Bus, at: number, dur: number, gain = 0.05) =>
  noise(b, { at, dur, gain, freq: 5200, q: 0.8, sweepTo: 2600, attack: 0.01, wet: 0.3 });

/** Little computer chirps: random-pitched square blips (the "data" voice of the cockpit). */
function blips(b: Bus, at: number, count: number, lo: number, hi: number, step = 0.045, gain = 0.03) {
  for (let i = 0; i < count; i++) {
    const f = lo * Math.pow(hi / lo, Math.random());
    tone(b, { at: at + i * step, dur: step * 0.8, gain, freq: f, type: "square", attack: 0.002 });
  }
}

/** Short comms "voice" phrase: formant-filtered pulse wave with pitch contour, per speaker. */
function phrase(b: Bus, at: number, contour: number[], o: { formant: number; type: OscillatorType; gain: number; grit?: boolean; step: number }) {
  const osc = b.ctx.createOscillator();
  osc.type = o.type;
  contour.forEach((f, i) => osc.frequency.setValueAtTime(f, at + i * o.step));
  const bp = b.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 3;
  bp.frequency.value = o.formant;
  // Syllable gating: an LFO-free amplitude chop, one bump per contour step.
  const g = b.ctx.createGain();
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, at);
  contour.forEach((_, i) => {
    const t = at + i * o.step;
    g.gain.exponentialRampToValueAtTime(o.gain, t + o.step * 0.25);
    g.gain.exponentialRampToValueAtTime(o.gain * 0.15, t + o.step * 0.9);
  });
  g.gain.exponentialRampToValueAtTime(0.0001, at + contour.length * o.step + 0.05);
  if (o.grit) {
    const drive = b.ctx.createGain();
    drive.gain.value = 12;
    osc.connect(bp).connect(g).connect(drive).connect(b.crunch);
  } else osc.connect(bp).connect(g).connect(b.out);
  const s = b.ctx.createGain();
  s.gain.value = 0.25;
  g.connect(s).connect(b.verb);
  osc.start(at);
  osc.stop(at + contour.length * o.step + 0.1);
}

// ── Cues ────────────────────────────────────────────────────────────────────────────────────
const CUES: Record<Cue, (b: Bus, t: number) => void> = {
  // Relay click: a dry mechanical tick with a tiny metallic ping.
  click: (b, t) => {
    noise(b, { at: t, dur: 0.025, gain: 0.22, freq: 2400, q: 2 });
    tone(b, { at: t, dur: 0.05, gain: 0.04, freq: 3100, type: "sine" });
  },
  // Order filled: arm actuator, latch clank, confirm tones.
  engage: (b, t) => {
    servo(b, t, 0.18, 220, 420, 0.1);
    metal(b, t + 0.17, 310, 0.08, 0.5);
    hiss(b, t + 0.2, 0.25, 0.035);
    tone(b, { at: t + 0.32, dur: 0.1, gain: 0.08, freq: 880, type: "square" });
    tone(b, { at: t + 0.43, dur: 0.16, gain: 0.08, freq: 1320, type: "square" });
  },
  // Target neutralized: reactor power-up, heavy chord stab, metallic shimmer.
  win: (b, t) => {
    servo(b, t, 0.5, 110, 440, 0.05);
    noise(b, { at: t, dur: 0.5, gain: 0.05, freq: 400, filter: "lowpass", sweepTo: 4000, q: 4 });
    [261.6, 329.6, 392, 523.3].forEach((f) =>
      tone(b, { at: t + 0.5, dur: 0.9, gain: 0.05, freq: f, type: "sawtooth", wet: 0.5, attack: 0.01 }),
    );
    tone(b, { at: t + 0.5, dur: 0.6, gain: 0.12, freq: 65, type: "sine" });
    metal(b, t + 0.5, 523, 0.06, 1.2);
    blips(b, t + 0.62, 6, 1500, 3000, 0.05, 0.02);
  },
  // Process complete: computer arpeggio and a soft chime.
  complete: (b, t) => {
    blips(b, t, 5, 900, 1800, 0.04, 0.04);
    tone(b, { at: t + 0.22, dur: 0.18, gain: 0.1, freq: 880, type: "triangle", wet: 0.4 });
    tone(b, { at: t + 0.34, dur: 0.45, gain: 0.1, freq: 1320, type: "triangle", wet: 0.5 });
  },
  // Boost: servo crouch, thruster spool and burn (swept noise + sub rumble + crackle).
  boost: (b, t) => {
    servo(b, t, 0.2, 180, 90, 0.05);
    hiss(b, t + 0.12, 0.3, 0.05);
    noise(b, { at: t + 0.2, dur: 1.15, gain: 0.16, freq: 300, filter: "lowpass", sweepTo: 2600, q: 0.7, attack: 0.25, wet: 0.25 });
    noise(b, { at: t + 0.25, dur: 1.0, gain: 0.05, freq: 1800, q: 6, sweepTo: 5200, attack: 0.3 });
    tone(b, { at: t + 0.2, dur: 1.1, gain: 0.14, freq: 48, slideTo: 72, type: "sine", attack: 0.2 });
    for (let i = 0; i < 9; i++) noise(b, { at: t + 0.35 + Math.random() * 0.8, dur: 0.03, gain: 0.07, freq: 1200 + Math.random() * 2500, q: 3 });
  },
  // Touchdown: heavy stomp, metal clank ringing in the bay, hydraulics settling.
  land: (b, t) => {
    tone(b, { at: t, dur: 0.35, gain: 0.35, freq: 72, slideTo: 34, type: "sine", attack: 0.003 });
    noise(b, { at: t, dur: 0.18, gain: 0.25, freq: 180, filter: "lowpass", q: 1 });
    metal(b, t + 0.01, 140, 0.16, 0.9);
    hiss(b, t + 0.12, 0.45, 0.05);
    servo(b, t + 0.2, 0.22, 140, 200, 0.03);
  },
  // Target lock: two quick rising sweeps, then a confirming double beep.
  lock: (b, t) => {
    tone(b, { at: t, dur: 0.08, gain: 0.09, freq: 1200, slideTo: 2400, type: "square" });
    tone(b, { at: t + 0.09, dur: 0.08, gain: 0.09, freq: 1200, slideTo: 2400, type: "square" });
    tone(b, { at: t + 0.2, dur: 0.05, gain: 0.08, freq: 2600, type: "square" });
    tone(b, { at: t + 0.27, dur: 0.09, gain: 0.08, freq: 2600, type: "square" });
  },
  // Grabbed: servo strain upward and a clamp release.
  pickup: (b, t) => {
    metal(b, t, 420, 0.08, 0.3);
    servo(b, t + 0.02, 0.28, 160, 330, 0.09);
    hiss(b, t + 0.05, 0.2, 0.03);
  },
  // Released: servo settle and a lighter clank.
  drop: (b, t) => {
    servo(b, t, 0.2, 300, 150, 0.04);
    metal(b, t + 0.16, 260, 0.07, 0.4);
  },
  // Radio squelch: band-limited noise burst with a key click.
  squelch: (b, t) => {
    noise(b, { at: t, dur: 0.16, gain: 0.18, freq: 1800, q: 1.5, sweepTo: 900 });
    tone(b, { at: t, dur: 0.03, gain: 0.04, freq: 1000, type: "square" });
    tone(b, { at: t + 0.12, dur: 0.06, gain: 0.03, freq: 1600, type: "square" });
  },
  // Incoming data: a short burst of soft chirps (throttled by the caller while text streams).
  chatter: (b, t) => blips(b, t, 3, 1400, 2800, 0.035, 0.022),
  // Catapult: capacitor charge whine and buzz, then the release slam and thrust.
  launch: (b, t) => {
    tone(b, { at: t, dur: 0.9, gain: 0.04, freq: 180, slideTo: 1900, type: "sawtooth", attack: 0.1 });
    tone(b, { at: t, dur: 0.9, gain: 0.02, freq: 60, type: "square", attack: 0.1 });
    metal(b, t + 0.9, 180, 0.15, 1);
    CUES.boost(b, t + 0.85);
  },
  // Channel open: key click, squelch opening upward, a rising two-note chirp.
  "comms-open": (b, t) => {
    tone(b, { at: t, dur: 0.03, gain: 0.05, freq: 1000, type: "square" });
    noise(b, { at: t + 0.02, dur: 0.18, gain: 0.12, freq: 700, q: 1.5, sweepTo: 2400 });
    tone(b, { at: t + 0.16, dur: 0.07, gain: 0.07, freq: 880, type: "square" });
    tone(b, { at: t + 0.24, dur: 0.11, gain: 0.07, freq: 1320, type: "square" });
  },
  // Channel cut: squelch falling away, a static tail, then a descending sign-off beep.
  "comms-close": (b, t) => {
    noise(b, { at: t, dur: 0.25, gain: 0.16, freq: 2200, q: 1.5, sweepTo: 500 });
    noise(b, { at: t + 0.15, dur: 0.4, gain: 0.05, freq: 3200, q: 0.6, attack: 0.02 });
    tone(b, { at: t + 0.42, dur: 0.07, gain: 0.07, freq: 1320, type: "square" });
    tone(b, { at: t + 0.5, dur: 0.12, gain: 0.07, freq: 880, type: "square" });
  },
  // Standby: turbine whine spinning down, servos folding, then a heavy relay clunk and a sigh of air.
  powerdown: (b, t) => {
    tone(b, { at: t, dur: 0.8, gain: 0.06, freq: 900, slideTo: 110, type: "sawtooth", wet: 0.3 });
    noise(b, { at: t, dur: 0.8, gain: 0.06, freq: 3000, filter: "lowpass", sweepTo: 200, q: 3 });
    servo(b, t + 0.15, 0.4, 320, 120, 0.06);
    tone(b, { at: t + 0.78, dur: 0.3, gain: 0.25, freq: 75, slideTo: 38, type: "sine", attack: 0.003 });
    metal(b, t + 0.78, 120, 0.07, 0.6);
    hiss(b, t + 0.85, 0.4, 0.04);
  },
  // Back online: relay click, turbine spinning up, servos unfolding, a ready chirp.
  powerup: (b, t) => {
    metal(b, t, 180, 0.05, 0.3);
    tone(b, { at: t + 0.05, dur: 0.7, gain: 0.06, freq: 110, slideTo: 900, type: "sawtooth", attack: 0.1, wet: 0.3 });
    noise(b, { at: t + 0.05, dur: 0.7, gain: 0.05, freq: 200, filter: "lowpass", sweepTo: 3200, q: 3, attack: 0.1 });
    servo(b, t + 0.2, 0.35, 140, 320, 0.06);
    tone(b, { at: t + 0.78, dur: 0.08, gain: 0.07, freq: 1320, type: "square" });
    tone(b, { at: t + 0.87, dur: 0.14, gain: 0.07, freq: 1760, type: "square" });
  },
  // Lock released: the lock-on chirp in reverse, falling.
  "brief-close": (b, t) => {
    tone(b, { at: t, dur: 0.07, gain: 0.07, freq: 2400, slideTo: 1200, type: "square" });
    tone(b, { at: t + 0.08, dur: 0.09, gain: 0.06, freq: 1800, slideTo: 700, type: "square" });
    noise(b, { at: t + 0.16, dur: 0.03, gain: 0.15, freq: 2000, q: 2 });
  },
  // Comms voices: JC-316 steady and mid-range; Vanguard quick and rising; Recoil low and gritty.
  "voice-jc316": (b, t) => {
    CUES.squelch(b, t);
    phrase(b, t + 0.12, [220, 260, 240, 300, 250], { formant: 900, type: "sawtooth", gain: 0.13, step: 0.07 });
  },
  "voice-sma_cross": (b, t) => {
    CUES.squelch(b, t);
    phrase(b, t + 0.12, [330, 400, 480, 440, 560, 620], { formant: 1400, type: "square", gain: 0.1, step: 0.05 });
  },
  "voice-rsi_revert": (b, t) => {
    CUES.squelch(b, t);
    phrase(b, t + 0.12, [110, 95, 120, 100, 85], { formant: 500, type: "sawtooth", gain: 0.08, step: 0.09, grit: true });
  },
};

// ── Recorded effects ────────────────────────────────────────────────────────────────────────
// The mechanical cues picked from ElevenLabs Sound Effects (scripts/generate-sfx.ts) play from
// public/sfx; everything else, and any sample that hasn't loaded, uses the synth above.
const SAMPLED = new Set<string>(sfxManifest.cues);
const samples = new Map<string, AudioBuffer | Promise<AudioBuffer | null> | null>();

function sample(b: Bus, cue: string) {
  if (!SAMPLED.has(cue)) return null;
  let s = samples.get(cue);
  if (s === undefined) {
    s = fetch(`/sfx/${cue}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((a) => b.ctx.decodeAudioData(a))
      .then((buf) => (samples.set(cue, buf), buf))
      .catch(() => (samples.set(cue, null), null));
    samples.set(cue, s);
  }
  return s;
}

/** Fetch and decode every recorded effect once, so the first boost or fill doesn't lag. */
function preload(b: Bus) {
  for (const cue of SAMPLED) sample(b, cue);
}

function playBuffer(b: Bus, buf: AudioBuffer) {
  const src = b.ctx.createBufferSource();
  src.buffer = buf;
  // Recorded effects are mastered hotter than the synth cues; trim them to sit at the same level.
  const trim = b.ctx.createGain();
  trim.gain.value = 0.55;
  src.connect(trim).connect(b.out);
  src.start(b.ctx.currentTime + 0.01);
}

export function play(cue: Cue, force = false) {
  if (!force && !soundEnabled()) return;
  try {
    const b = engine();
    if (b.ctx.state === "suspended") void b.ctx.resume();
    preload(b);
    const s = sample(b, cue);
    if (s instanceof AudioBuffer) playBuffer(b, s);
    else if (s instanceof Promise) {
      // Still loading (e.g. the launch right after SFX is switched on): wait briefly, else synthesize.
      const late = new Promise<null>((r) => setTimeout(() => r(null), 600));
      void Promise.race([s, late]).then((buf) => (buf ? playBuffer(b, buf) : CUES[cue](b, b.ctx.currentTime + 0.01)));
    } else CUES[cue](b, b.ctx.currentTime + 0.01);
  } catch {
    // Audio unavailable (or not yet allowed): ignore.
  }
}

// ── Voice (opt-in) ──────────────────────────────────────────────────────────────────────────
// The voices themselves (ElevenLabs clips) play through lib/voice-player.ts; this is just the toggle.
const VOICE_KEY = "pt-voice";

export function voiceEnabled() {
  try {
    return localStorage.getItem(VOICE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setVoiceEnabled(on: boolean) {
  try {
    localStorage.setItem(VOICE_KEY, on ? "on" : "off");
  } catch {}
  window.dispatchEvent(new Event("pt-sound"));
}
