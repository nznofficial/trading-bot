/**
 * Discord alerts ("incoming transmissions"). A no-op unless DISCORD_WEBHOOK_URL is set, and never
 * throws: an alert failing must not fail a trading tick.
 */

export type Embed = {
  title: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

export const COLORS = {
  error: 0xff3b4e,
  buy: 0xa3ff3c,
  sell: 0xffa41b,
  win: 0x8b5cf6,
  debrief: 0x3ce4ff,
} as const;

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "https://trading-bot-flame-seven.vercel.app";

export async function notify(embeds: Embed[]) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || !embeds.length) return;
  // Discord allows up to 10 embeds per message.
  for (let i = 0; i < embeds.length; i += 10) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "Paper Trader // Bridge",
          embeds: embeds.slice(i, i + 10).map((e) => ({
            ...e,
            url: DASHBOARD_URL,
            footer: e.footer ?? { text: "Paper Trader · simulated account" },
            timestamp: e.timestamp ?? new Date().toISOString(),
          })),
        }),
      });
      if (!res.ok) console.warn("discord alert failed", res.status, await res.text());
    } catch (e) {
      console.warn("discord alert failed", e);
    }
  }
}
