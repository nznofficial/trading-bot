/**
 * Mech comms processing for the ElevenLabs voices: radio band-limiting, a ring modulator for the
 * metallic "machine" timbre, a short comb resonance (a voice inside a cockpit), and saturation.
 * Each speaker gets its own preset. Self-contained on purpose (no outer references), so the voice
 * preview page can embed it verbatim via VOICE_FX_SOURCE.
 */
export function playVoice(
  ctx: AudioContext,
  buffer: AudioBuffer,
  who: string,
  fx = true,
  dest: AudioNode = ctx.destination,
  level = 1,
): AudioBufferSourceNode {
  const presets: Record<string, { hp: number; lp: number; ring: number; ringMix: number; drive: number; comb: number; combFb: number; combMix: number }> = {
    jc316: { hp: 190, lp: 4300, ring: 58, ringMix: 0.2, drive: 1.6, comb: 0.009, combFb: 0.35, combMix: 0.28 },
    vanguard: { hp: 280, lp: 5400, ring: 92, ringMix: 0.12, drive: 1.3, comb: 0.006, combFb: 0.25, combMix: 0.2 },
    recoil: { hp: 110, lp: 3300, ring: 38, ringMix: 0.3, drive: 3, comb: 0.012, combFb: 0.42, combMix: 0.34 },
  };
  const p = presets[who] ?? presets.jc316;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const out = ctx.createGain();
  out.gain.value = level;
  out.connect(dest);
  if (!fx) {
    src.connect(out);
    src.start();
    return src;
  }

  // The ring, comb and presence stages add energy; trim so the processed voice peaks like the raw one.
  out.gain.value = level * 0.55;

  // Radio band: cut lows and highs, lift presence.
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = p.hp;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = p.lp;
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 1900;
  presence.gain.value = 5;
  presence.Q.value = 0.9;
  src.connect(hp).connect(lp).connect(presence);

  // Saturation (more for Recoil's grit), normalized so loudness stays put.
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = (i / 1023) * 2 - 1;
    curve[i] = Math.tanh(x * p.drive) / Math.tanh(p.drive);
  }
  shaper.curve = curve;
  presence.connect(shaper);

  // Ring modulation: multiply by a low sine for the machine timbre, blended with the dry voice.
  const dry = ctx.createGain();
  dry.gain.value = 1 - p.ringMix;
  const ringAmp = ctx.createGain();
  ringAmp.gain.value = 0;
  const carrier = ctx.createOscillator();
  carrier.frequency.value = p.ring;
  const carrierDepth = ctx.createGain();
  carrierDepth.gain.value = p.ringMix * 2;
  carrier.connect(carrierDepth).connect(ringAmp.gain);
  shaper.connect(dry).connect(out);
  shaper.connect(ringAmp).connect(out);

  // Cockpit resonance: a short feedback comb.
  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = p.comb;
  const fb = ctx.createGain();
  fb.gain.value = p.combFb;
  const combOut = ctx.createGain();
  combOut.gain.value = p.combMix;
  shaper.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(combOut).connect(out);

  carrier.start();
  src.start();
  src.onended = () => carrier.stop();
  return src;
}

/** The function's compiled source, for embedding in the standalone preview page. */
export const VOICE_FX_SOURCE = playVoice.toString();
