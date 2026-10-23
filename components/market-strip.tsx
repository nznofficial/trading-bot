import { connection } from "next/server";
import { SessionClock } from "@/components/session-clock";
import { dateTime, signedPct } from "@/lib/format";
import { getMarketStrip } from "@/lib/queries";
import type { Quote } from "@/lib/quotes";

/** Session status + ticker tape under the header. Reads only what the bot stored; never calls Alpaca. */
export async function MarketStrip() {
  await connection();
  const { quotes, clock, paused, lastRun } = await getMarketStrip();

  return (
    <div className="border-b border-line bg-[#070b0f]/90">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-2">
        <SessionClock clock={clock} />
        <span className="flex items-center gap-2">
          <span aria-hidden className="live-dot size-1.5 rounded-full bg-good text-good" />
          <span className="label">Crypto</span>
          <span className="font-label text-[10px] tracking-[0.16em] text-ink">24/7</span>
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="label">Bot</span>
          {paused ? (
            <span className="font-label text-[10px] tracking-[0.16em] text-warning">PAUSED</span>
          ) : lastRun ? (
            <span className={`num text-[11px] ${lastRun.status === "error" ? "text-loss" : "text-ink-2"}`}>
              {lastRun.status === "error" ? "ERROR · " : ""}last run {dateTime(lastRun.startedAt)}
            </span>
          ) : (
            <span className="num text-[11px] text-muted">no runs yet</span>
          )}
        </span>
      </div>
      {quotes.length > 0 && <TickerTape quotes={quotes} />}
    </div>
  );
}

function TickerTape({ quotes }: { quotes: Quote[] }) {
  // Two copies side by side; the track slides by half its width for a seamless loop.
  const items = [...quotes, ...quotes];
  return (
    <div
      className="ticker relative overflow-hidden border-t border-line/60 [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
      aria-label="Latest prices"
    >
      <ul className="ticker-track py-2">
        {items.map((q, i) => (
          <li
            key={`${q.symbol}-${i}`}
            aria-hidden={i >= quotes.length}
            className="flex items-center gap-2 border-r border-line/50 px-5 whitespace-nowrap"
          >
            <span className="font-label text-[10px] tracking-[0.12em] text-ink">{q.symbol}</span>
            <span className="num text-[12px] text-ink-2">{formatPrice(q.price)}</span>
            <span className={`num text-[11px] ${q.change > 0 ? "text-gold" : q.change < 0 ? "text-loss" : "text-muted"}`}>
              {q.change > 0 ? "▲" : q.change < 0 ? "▼" : "■"} {signedPct(q.changePct)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const formatPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

export function MarketStripSkeleton() {
  return (
    <div className="border-b border-line bg-[#070b0f]/90">
      <div className="mx-auto max-w-6xl px-4 py-2">
        <div className="skeleton h-4 w-64 rounded" />
      </div>
      <div className="border-t border-line/60 px-4 py-2">
        <div className="skeleton h-4 w-full rounded" />
      </div>
    </div>
  );
}
