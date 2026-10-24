/**
 * Cockpit sound effects, synthesized with Web Audio (no audio files). Off by default; the header
 * toggle stores the choice per browser. Browsers only allow audio after a user gesture, so cues
 * that fire before any interaction are silently skipped.
 */
export type Cue = "click" | "engage" | "win" | "complete" | "boost";

const KEY = "pt-sound";
let ctx: AudioContext | null = null;

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

function tone(at: number, freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(c.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

export function play(cue: Cue, force = false) {
  if (!force && !soundEnabled()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const t = ctx.currentTime + 0.01;
    switch (cue) {
      case "click":
        tone(t, 1800, 0.04, "square", 0.025);
        break;
      case "engage":
        tone(t, 660, 0.09, "triangle", 0.08);
        tone(t + 0.09, 990, 0.14, "triangle", 0.08);
        break;
      case "win":
        [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.09, f, 0.22, "sawtooth", 0.05));
        tone(t + 0.36, 1047, 0.5, "triangle", 0.06);
        break;
      case "boost":
        // Thrusters spooling up, a long burn, then touchdown as the dock lands (~1.4s later).
        tone(t, 110, 0.5, "sawtooth", 0.035, 520);
        tone(t + 0.22, 1400, 0.05, "square", 0.015);
        tone(t + 0.3, 520, 0.85, "sawtooth", 0.025, 900);
        tone(t + 1.42, 140, 0.16, "triangle", 0.07, 55);
        break;
      case "complete":
        tone(t, 880, 0.12, "sine", 0.08);
        tone(t + 0.12, 1320, 0.25, "sine", 0.07);
        break;
    }
  } catch {
    // Audio unavailable (or not yet allowed): ignore.
  }
}
