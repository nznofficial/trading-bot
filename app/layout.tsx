import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { IBM_Plex_Sans, JetBrains_Mono, Michroma, Orbitron } from "next/font/google";
import { Suspense } from "react";
import { ChartGlowDefs } from "@/components/charts";
import { MarketStrip, MarketStripSkeleton } from "@/components/market-strip";
import { Nav } from "@/components/nav";
import "./globals.css";

const orbitron = Orbitron({ variable: "--font-orbitron", subsets: ["latin"], weight: ["500", "700", "900"] });
const michroma = Michroma({ variable: "--font-michroma", subsets: ["latin"], weight: "400" });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Paper Trader",
  description: "Rule-based paper trading bot on Alpaca: stocks and crypto, live history, positions, and analytics.",
};

export const viewport: Viewport = { themeColor: "#05070a", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${orbitron.variable} ${michroma.variable} ${plex.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ChartGlowDefs />
        <header className="relative border-b border-line bg-[#05070a]/80 backdrop-blur">
          <div className="horizon" aria-hidden />
          <div className="relative mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4">
            <Link href="/" className="group flex items-center gap-3">
              <Logo />
              <div className="leading-none">
                <div className="glow-text font-display text-[15px] font-bold tracking-[0.28em] text-ink">
                  PAPER<span className="text-neon">/</span>TRADER
                </div>
                <div className="label mt-1.5 text-[8px]! tracking-[0.3em]!">Alpaca · Paper Account</div>
              </div>
            </Link>
            <Nav />
          </div>
        </header>
        <Suspense fallback={<MarketStripSkeleton />}>
          <MarketStrip />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-4 py-5">
            <span className="label">Simulated trading · Not investment advice</span>
            <span className="label">Data: IEX stock feed · Alpaca crypto feed</span>
          </div>
        </footer>
      </body>
    </html>
  );
}

/** Brand mark: a light-cycle diamond with a rising trace. */
function Logo() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden className="drop-shadow-[0_0_8px_rgba(0,229,255,0.55)]">
      <path d="M17 2 32 17 17 32 2 17Z" fill="none" stroke="var(--neon)" strokeWidth="1.25" />
      <path d="M17 7 27 17 17 27 7 17Z" fill="rgba(0,229,255,0.08)" stroke="var(--neon-line)" strokeWidth="1" />
      <path d="M9 21 14 16 18 19 25 11" fill="none" stroke="var(--gold)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="25" cy="11" r="1.6" fill="var(--gold)" />
    </svg>
  );
}
