import { connection } from "next/server";
import { SessionClock } from "@/components/session-clock";
import { CueOnChange, SoundToggle, VoiceToggle } from "@/components/sound";
import { signedPct } from "@/lib/format";
import { getMarketStrip } from "@/lib/queries";
import type { Quote } from "@/lib/quotes";

/** Theater status for the header: NYSE online/offline with countdown, crypto always online. */
export async function SessionStatus() {
  await connection();
  const { clock, paused, latestFillId } = await getMarketStrip();
  return (
    <div className="hud flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
      <SessionClock clock={clock} />
      <span className="flex items-center gap-1.5 text-ink-2">
        <span aria-hidden className="blink size-1.5 bg-sync" />
        Crypto <span className="text-sync">online 24/7</span>
      </span>
      {paused && <span className="border border-amber/60 px-1.5 text-amber">Bot on hold</span>}
      <SoundToggle />
      <VoiceToggle />
      {/* Auto-refresh re-renders this; a new fill id chirps if sound is on. */}
      <CueOnChange value={latestFillId} cue="engage" />
    </div>
  );
}

/** Scrolling target feed of the latest prices the bot recorded (never fetched at render time). */
export async function TargetFeed() {
  await connection();
  const { quotes } = await getMarketStrip();
  if (!quotes.length) return null;
  const items = [...quotes, ...quotes]; // two copies; the track slides half its width
  return (
    <div className="flex items-stretch border-b border-line bg-[#0b0a10]">
      <div className="hud flex shrink-0 items-center bg-unit px-3 text-[11px] text-white">Target feed</div>
      <div
        className="ticker relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_3%,black_97%,transparent)]"
        aria-label="Latest prices"
      >
        <ul className="ticker-track h-8 items-center">
          {items.map((q, i) => (
            <FeedItem key={`${q.symbol}-${i}`} q={q} hidden={i >= quotes.length} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function FeedItem({ q, hidden }: { q: Quote; hidden: boolean }) {
  const tone = q.change > 0 ? "text-gain" : q.change < 0 ? "text-loss" : "text-muted";
  return (
    <li aria-hidden={hidden} className="flex items-center gap-2 border-r border-line px-4 text-[12px] whitespace-nowrap">
      <span className="num font-medium text-ink">{q.symbol}</span>
      <span className="num text-ink-2">{formatPrice(q.price)}</span>
      <span className={`num ${tone}`}>{signedPct(q.changePct)}</span>
    </li>
  );
}

const formatPrice = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 10 ? 4 : 2 });

export function TargetFeedSkeleton() {
  return <div className="skeleton h-8 border-b border-line" />;
}
