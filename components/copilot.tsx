import { connection } from "next/server";
import { CopilotDock } from "@/components/copilot-dock";
import { getMarketStrip, getOverview } from "@/lib/queries";

/** "in 7h 12m" until the next session boundary, from the clock the bot stored. */
function untilPhrase(iso: string | undefined) {
  if (!iso) return null;
  const m = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  const h = Math.floor(m / 60);
  return h ? `in ${h}h ${m % 60}m` : `in ${m}m`;
}

/** Server wrapper: gathers live data (cached queries) for JC-316; the dock picks state + line client-side. */
export async function Copilot() {
  await connection();
  const [o, strip] = await Promise.all([getOverview(), getMarketStrip()]);
  const k = o.kpis;
  return (
    <CopilotDock
      data={{
        paused: strip.paused,
        marketOpen: strip.clock?.isOpen ?? false,
        nextOpenIn: untilPhrase(strip.clock?.nextOpen),
        lastRun: o.lastRun ? { id: o.lastRun.id, status: o.lastRun.status, error: o.lastRun.error } : null,
        dayPnl: k?.dayPnl ?? 0,
        dayPnlPct: k?.dayPnlPct ?? 0,
        currentDrawdown: k?.currentDrawdown ?? 0,
        equity: k?.equity ?? 0,
        streak: o.streak,
        positions: o.positions.map((p) => ({ symbol: p.symbol, unrealizedPl: p.unrealizedPl, strategy: p.strategy })),
        bigWin: o.bigWin
          ? { symbol: o.bigWin.symbol, pnl: o.bigWin.pnl, returnPct: o.bigWin.returnPct, strategy: o.bigWin.strategy }
          : null,
      }}
    />
  );
}
