import { connection } from "next/server";
import { SessionClock } from "@/components/session-clock";
import { signedPct } from "@/lib/format";
import { getMarketStrip } from "@/lib/queries";
import type { Quote } from "@/lib/quotes";

/** Market session + crypto status for the header. Reads only what the bot stored; never calls Alpaca. */
export async function HeaderStatus() {
  await connection();
  const { clock } = await getMarketStrip();
  return (
    <div className="flex items-center gap-5 text-xs">
      <SessionClock clock={clock} />
      <span className="h-3.5 w-px bg-line-2" aria-hidden />
      <span className="flex items-center gap-1.5 text-ink-2">
        <span aria-hidden className="live-dot size-1.5 rounded-full bg-good" />
        Crypto <span className="text-muted">24/7</span>
      </span>
    </div>
  );
}

/** Scrolling tape of the latest prices the bot recorded. */
export async function Ticker() {
  await connection();
  const { quotes } = await getMarketStrip();
  if (!quotes.length) return null;
  // Two copies side by side; the track slides by half its width for a seamless loop.
  const items = [...quotes, ...quotes];
  return (
    <div
      className="ticker relative overflow-hidden border-t border-line bg-[#090c10] [mask-image:linear-gradient(90deg,transparent,black_4%,black_96%,transparent)]"
      aria-label="Latest prices"
    >
      <ul className="ticker-track h-8 items-center">
        {items.map((q, i) => (
          <TickerItem key={`${q.symbol}-${i}`} q={q} hidden={i >= quotes.length} />
        ))}
      </ul>
    </div>
  );
}

function TickerItem({ q, hidden }: { q: Quote; hidden: boolean }) {
  const tone = q.change > 0 ? "text-gold" : q.change < 0 ? "text-loss" : "text-muted";
  return (
    <li aria-hidden={hidden} className="flex items-center gap-2 px-4 text-xs whitespace-nowrap">
      <span className="font-medium text-ink-2">{q.symbol}</span>
      <span className="num text-ink">{formatPrice(q.price)}</span>
      <span className={`num ${tone}`}>
        <span aria-hidden className="mr-0.5 text-[9px]">{q.change > 0 ? "▲" : q.change < 0 ? "▼" : ""}</span>
        {signedPct(q.changePct)}
      </span>
    </li>
  );
}

const formatPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

export function TickerSkeleton() {
  return <div className="skeleton h-8 border-t border-line" />;
}
