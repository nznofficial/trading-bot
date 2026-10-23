"use client";

import { useSyncExternalStore } from "react";
import type { ClockState } from "@/lib/queries";

/** One-second clock shared by subscribers. Server render gets null (placeholder digits). */
const subscribe = (onTick: () => void) => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
};
// Floored to the second so the snapshot is stable between ticks.
const getNow = () => Math.floor(Date.now() / 1000) * 1000;
const getServerNow = () => null;

function tMinus(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d > 0 ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

/**
 * NYSE theater status from the clock the bot stored on its last tick. Once a stored boundary
 * passes, the state flips even if no tick has run since.
 */
export function SessionClock({ clock }: { clock: ClockState | null }) {
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);
  if (!clock) return <span className="text-muted">NYSE · awaiting first sortie</span>;

  const nextOpen = Date.parse(clock.nextOpen);
  const nextClose = Date.parse(clock.nextClose);
  const t = now ?? Date.parse(clock.asOf);
  const open = clock.isOpen ? t < nextClose : t >= nextOpen && t < nextClose;
  const target = open ? nextClose : nextOpen;
  const stale = !open && t >= nextOpen; // stored next-open already passed; wait for the next tick

  return (
    <span className="flex items-center gap-1.5 text-ink-2">
      <span aria-hidden className={`size-1.5 ${open ? "blink bg-sync" : "bg-alert"}`} />
      NYSE <span className={open ? "text-sync" : "text-alert"}>{open ? "online" : "offline"}</span>
      {!stale && (
        <span className="text-muted">
          · {open ? "disengage" : "activation"} T−<span className="num text-ink">{now === null ? "--:--:--" : tMinus(target - now)}</span>
        </span>
      )}
    </span>
  );
}
