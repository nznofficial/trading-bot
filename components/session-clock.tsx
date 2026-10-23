"use client";

import { useSyncExternalStore } from "react";
import type { ClockState } from "@/lib/queries";

/** One-second clock shared by every subscriber. Server render gets null (placeholder digits). */
const subscribe = (onTick: () => void) => {
  const id = setInterval(onTick, 1000);
  return () => clearInterval(id);
};
// Floored to the second so the snapshot is stable between ticks.
const getNow = () => Math.floor(Date.now() / 1000) * 1000;
const getServerNow = () => null;

function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d > 0 ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/**
 * NYSE session state with a live countdown. Works from the clock the bot stored on its last tick:
 * once the stored boundary passes, the session has flipped, even if no tick has run since.
 */
export function SessionClock({ clock }: { clock: ClockState | null }) {
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);

  if (!clock) return <span className="text-xs text-muted">NYSE · awaiting first tick</span>;

  const nextOpen = Date.parse(clock.nextOpen);
  const nextClose = Date.parse(clock.nextClose);
  // Derive state from the stored boundaries so the bar stays right between ticks.
  const t = now ?? Date.parse(clock.asOf);
  const open = clock.isOpen ? t < nextClose : t >= nextOpen && t < nextClose;
  const target = open ? nextClose : nextOpen;
  const stale = !open && t >= nextOpen; // stored next-open already passed; wait for the next tick

  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden className={`size-1.5 rounded-full ${open ? "live-dot bg-good" : "bg-muted"}`} />
      NYSE <span className={open ? "text-good" : "text-muted"}>{open ? "Open" : "Closed"}</span>
      {!stale && (
        <>
          <span className="text-muted">· {open ? "closes in" : "opens in"}</span>
          <span className="num text-ink">{now === null ? "--:--:--" : countdown(target - now)}</span>
        </>
      )}
    </span>
  );
}
