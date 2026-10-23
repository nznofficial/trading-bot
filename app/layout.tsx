import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderStatus, Ticker, TickerSkeleton } from "@/components/market-strip";
import { Nav } from "@/components/nav";
import "./globals.css";

const plexSans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Paper Trader",
  description: "Rule-based paper trading bot on Alpaca: stocks and crypto, live history, positions, and analytics.",
};

export const viewport: Viewport = { themeColor: "#07090c", colorScheme: "dark" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col text-[14px]">
        <header className="sticky top-0 z-20 border-b border-line bg-[#07090c]/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <Mark />
              <span className="text-[15px] font-semibold tracking-tight text-ink">Paper Trader</span>
              <span className="rounded border border-accent/40 px-1.5 py-px text-[10px] font-medium tracking-wider text-accent uppercase">
                Paper
              </span>
            </Link>
            <Nav />
            <div className="ml-auto hidden md:block">
              <Suspense fallback={<div className="skeleton h-4 w-56 rounded" />}>
                <HeaderStatus />
              </Suspense>
            </div>
          </div>
          <div className="border-t border-line px-4 py-2 md:hidden">
            <Suspense fallback={<div className="skeleton h-4 w-56 rounded" />}>
              <HeaderStatus />
            </Suspense>
          </div>
          <Suspense fallback={<TickerSkeleton />}>
            <Ticker />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-5 text-xs text-muted sm:px-6">
            <span>Simulated trading on an Alpaca paper account. Not investment advice.</span>
            <span>Market data: IEX (stocks), Alpaca (crypto)</span>
          </div>
        </footer>
      </body>
    </html>
  );
}

/** Brand mark: a rising trace inside a hairline frame. */
function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="0.5" y="0.5" width="21" height="21" rx="5" fill="var(--panel-2)" stroke="var(--line-2)" />
      <path d="M5 14.5 9 10.5l3 2.5 5-6" fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="7" r="1.4" fill="var(--gold)" />
    </svg>
  );
}
