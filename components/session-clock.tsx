"use client";

import { useSyncExternalStore } from "react";
import type { ClockState } from "@/lib/queries";

/** Minute-resolution clock shared by subscribers. Server render gets null. */
const subscribe = (onTick: () => void) => {
  const id = setInterval(onTick, 15_000);
  return () => clearInterval(id);
};
// Floored to the minute so the snapshot is stable between ticks.
const getNow = () => Math.floor(Date.now() / 60_000) * 60_000;
const getServerNow = () => null;

function until(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

/**
 * U.S. market session from the clock the bot stored on its last tick. Once a stored boundary
 * passes, the state flips even if no tick has run since.
 */
export function SessionClock({ clock }: { clock: ClockState | null }) {
  const now = useSyncExternalStore(subscribe, getNow, getServerNow);
  if (!clock) return null;

  const nextOpen = Date.parse(clock.nextOpen);
  const nextClose = Date.parse(clock.nextClose);
  const t = now ?? Date.parse(clock.asOf);
  const open = clock.isOpen ? t < nextClose : t >= nextOpen && t < nextClose;
  const target = open ? nextClose : nextOpen;
  const stale = !open && t >= nextOpen; // stored next-open already passed; wait for the next tick

  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden className={`size-2 rounded-full ${open ? "bg-[#3ccf7a]" : "bg-white/40"}`} />
      <span className="text-white">U.S. markets {open ? "open" : "closed"}</span>
      {!stale && now !== null && (
        <span className="hidden text-white/60 md:inline">
          · {open ? "Closes" : "Opens"} in {until(target - now)}
        </span>
      )}
    </span>
  );
}
