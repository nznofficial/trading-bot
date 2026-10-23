import type { Bar } from "@/lib/alpaca";

/** Build 15-minute bars from a close series; o/h/l hug the close. */
export function barsFrom(closes: number[]): Bar[] {
  const start = Date.parse("2026-10-01T13:30:00Z");
  return closes.map((c, i) => ({
    t: new Date(start + i * 15 * 60_000).toISOString(),
    o: c,
    h: c + 0.5,
    l: c - 0.5,
    c,
    v: 1000,
  }));
}

export const range = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
