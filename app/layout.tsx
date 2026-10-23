import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, IBM_Plex_Mono, Shippori_Mincho_B1 } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Copilot } from "@/components/copilot";
import { Crest } from "@/components/emblems";
import { LAUNCH_SCRIPT, LaunchIntro } from "@/components/launch-intro";
import { SessionStatus, TargetFeed, TargetFeedSkeleton } from "@/components/market-strip";
import { Nav } from "@/components/nav";
import "./globals.css";

const barlow = Barlow({ variable: "--font-barlow", subsets: ["latin"], weight: ["400", "500", "600"] });
const condensed = Barlow_Condensed({ variable: "--font-barlow-condensed", subsets: ["latin"], weight: ["500", "600", "700"] });
const mincho = Shippori_Mincho_B1({ variable: "--font-mincho", subsets: ["latin"], weight: ["800"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Paper Trader",
  description: "Mecha-cockpit paper trading HUD: stocks and crypto on Alpaca, with live positions, combat log and analytics.",
};

export const viewport: Viewport = { themeColor: "#08070c", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${condensed.variable} ${mincho.variable} ${mono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Marks repeat visits before first paint so the launch sequence plays once per session. */}
        <script dangerouslySetInnerHTML={{ __html: LAUNCH_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <LaunchIntro />
        <AutoRefresh />
        <header className="border-b border-line-2 bg-[#08070c]/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pt-3 sm:px-6">
            <Link href="/" className="flex items-center gap-3">
              <Crest />
              <div className="leading-none">
                <div className="font-title text-[19px] font-extrabold tracking-tight text-ink">Paper Trader</div>
                <div className="hud mt-1 text-[10px] text-amber">Tactical trading frame · Alpaca paper</div>
              </div>
            </Link>
            <Suspense fallback={null}>
              <SessionStatus />
            </Suspense>
          </div>
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <Nav />
          </div>
          <div className="hazard-thin" aria-hidden />
          <Suspense fallback={<TargetFeedSkeleton />}>
            <TargetFeed />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        {/* JC-316 copilot companion, on every page */}
        <Suspense fallback={null}>
          <Copilot />
        </Suspense>
        <footer className="border-t border-line-2">
          <div className="hazard-thin opacity-40" aria-hidden />
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-5 text-[12px] text-muted sm:px-6">
            <span>Simulation only — Alpaca paper account. No real money. Not investment advice.</span>
            <span className="hud">Feeds: IEX equities · Alpaca crypto · 15-min cycle</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
