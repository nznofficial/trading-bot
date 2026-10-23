const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0Fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const usd = (n: number) => usdFmt.format(n);
export const usd0 = (n: number) => usd0Fmt.format(n);
export const signedUsd = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + usdFmt.format(Math.abs(n));
export const pct = (n: number, digits = 2) => `${(n * 100).toFixed(digits)}%`;
export const signedPct = (n: number, digits = 2) =>
  (n > 0 ? "+" : n < 0 ? "−" : "") + `${Math.abs(n * 100).toFixed(digits)}%`;
export const ratio = (n: number | null, digits = 2) =>
  n === null ? "—" : Number.isFinite(n) ? n.toFixed(digits) : "∞";
export const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(4));

const tz = "America/New_York";
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: tz,
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" });
const dateYearFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });

export const dateTime = (ms: number) => `${dateTimeFmt.format(ms)} ET`;
export const shortDate = (ms: number) => dateFmt.format(ms);
export const longDate = (ms: number) => dateYearFmt.format(ms);
/** "2026-10-22" → "Oct 22" without timezone drift. */
export const isoDayLabel = (d: string) => dateFmt.format(new Date(`${d}T12:00:00-04:00`));

export function duration(ms: number | null) {
  if (ms === null) return "—";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export const strategyLabel = (id: string | null) =>
  id === "sma_cross" ? "SMA Cross" : id === "rsi_revert" ? "RSI Revert" : (id ?? "manual");
