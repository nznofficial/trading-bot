import { connection } from "next/server";
import { SessionClock } from "@/components/session-clock";
import { signedPct } from "@/lib/format";
import { getMarketStrip } from "@/lib/queries";
import type { Quote } from "@/lib/quotes";

/** "U.S. markets closed · Opens in 7h 12m" for the global bar. */
export async function SessionStatus() {
  await connection();
  const { clock } = await getMarketStrip();
  return <SessionClock clock={clock} />;
}

/** Static markets strip: the latest prices the bot recorded (it never calls Alpaca at render time). */
export async function MarketsBar() {
  await connection();
  const { quotes } = await getMarketStrip();
  if (!quotes.length) return null;
  return (
    <div className="border-b border-line bg-surface-2">
      <div className="mx-auto flex max-w-[1200px] items-center gap-6 overflow-x-auto px-4 py-2 sm:px-6">
        <span className="shrink-0 text-[12px] font-semibold text-ink-2">Markets</span>
        <ul className="flex gap-6">
          {quotes.map((q) => (
            <QuoteItem key={q.symbol} q={q} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function QuoteItem({ q }: { q: Quote }) {
  const tone = q.change > 0 ? "text-gain" : q.change < 0 ? "text-loss" : "text-muted";
  return (
    <li className="num flex shrink-0 items-baseline gap-1.5 text-[12px] whitespace-nowrap">
      <span className="font-semibold text-ink">{q.symbol.replace("/USD", "")}</span>
      <span className="text-ink-2">{formatPrice(q.price)}</span>
      <span className={tone}>{signedPct(q.changePct)}</span>
    </li>
  );
}

const formatPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

export function MarketsBarSkeleton() {
  return <div className="h-[33px] border-b border-line bg-surface-2" />;
}
