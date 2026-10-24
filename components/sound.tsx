"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { play, setSoundEnabled, setVoiceEnabled, soundEnabled, voiceEnabled, type Cue } from "@/lib/sfx";
import { JC_LINES } from "@/lib/voice-lines";
import { sayLine, stopVoice } from "@/lib/voice-player";

const subscribe = (cb: () => void) => {
  window.addEventListener("pt-sound", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("pt-sound", cb);
    window.removeEventListener("storage", cb);
  };
};

/** Header toggle. Off by default; turning it on fires the catapult launch (which also unlocks audio). */
export function SoundToggle() {
  const on = useSyncExternalStore(subscribe, soundEnabled, () => false);
  return (
    <button
      type="button"
      onClick={() => {
        setSoundEnabled(!on);
        if (!on) play("launch", true);
      }}
      aria-pressed={on}
      className={`hud border px-2 py-0.5 text-[11px] transition-colors ${
        on ? "border-sync/60 text-sync" : "border-line-2 text-muted hover:text-ink-2"
      }`}
    >
      SFX {on ? "on" : "off"}
    </button>
  );
}

/**
 * Opt-in spoken lines in the ElevenLabs voices (lib/voice-player.ts): wingman catchphrases and
 * JC-316's acknowledgements on briefings, and the opening of comms replies. Off by default and
 * independent of SFX.
 */
export function VoiceToggle() {
  const on = useSyncExternalStore(subscribe, voiceEnabled, () => false);
  return (
    <button
      type="button"
      onClick={() => {
        setVoiceEnabled(!on);
        if (!on) sayLine("jc316", JC_LINES.online, true);
        else stopVoice();
      }}
      aria-pressed={on}
      title="Read briefings and comms replies aloud"
      className={`hud border px-2 py-0.5 text-[11px] transition-colors ${
        on ? "border-sync/60 text-sync" : "border-line-2 text-muted hover:text-ink-2"
      }`}
    >
      Voice {on ? "on" : "off"}
    </button>
  );
}

/** Plays a cue whenever `value` changes after the first render (e.g. a new fill arrives on refresh). */
export function CueOnChange({ value, cue }: { value: string | null; cue: Cue }) {
  const prev = useRef(value);
  const mounted = useRef(false);
  useEffect(() => {
    // Skip the initial render; chirp on any later change, including the very first fill ever.
    if (mounted.current && value && value !== prev.current) play(cue);
    mounted.current = true;
    prev.current = value;
  }, [value, cue]);
  return null;
}

/** Plays a cue once per browser session for a given id (e.g. one fanfare per big win). */
export function CueOnce({ id, cue }: { id: string; cue: Cue }) {
  useEffect(() => {
    const key = `pt-cue-${cue}-${id}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    play(cue);
  }, [id, cue]);
  return null;
}
