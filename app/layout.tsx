import type { Metadata, Viewport } from "next";
import { Source_Sans_3, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { MarketsBar, MarketsBarSkeleton, SessionStatus } from "@/components/market-strip";
import { Nav } from "@/components/nav";
import "./globals.css";

const sans = Source_Sans_3({ variable: "--font-source-sans", subsets: ["latin"], weight: ["400", "600", "700"] });
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: "Paper Trader",
  description: "Rule-based paper trading on Alpaca: stocks and crypto, holdings, history and performance.",
};

export const viewport: Viewport = { themeColor: "#0b2341", colorScheme: "light" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header>
          {/* Global bar */}
          <div className="bg-navy text-white">
            <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6">
              <Link href="/" className="flex items-center gap-3">
                <Mark />
                <span className="text-[17px] font-semibold tracking-[-0.01em]">Paper Trader</span>
              </Link>
              <div className="flex items-center gap-5 text-[13px] text-white/75">
                <span className="hidden sm:inline">
                  Simulated account <span className="text-white/45">·</span> Alpaca Paper
                </span>
                <Suspense fallback={null}>
                  <SessionStatus />
                </Suspense>
              </div>
            </div>
          </div>
          {/* Section navigation */}
          <div className="border-b border-line bg-white">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
              <Nav />
            </div>
          </div>
          <Suspense fallback={<MarketsBarSkeleton />}>
            <MarketsBar />
          </Suspense>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-7 sm:px-6">{children}</main>
        <footer className="border-t border-line bg-white">
          <div className="mx-auto max-w-[1200px] space-y-1 px-4 py-6 text-[12px] leading-relaxed text-muted sm:px-6">
            <p>
              Paper Trader places simulated orders in an Alpaca paper account. No real money is invested and nothing on
              this page is investment advice. Past performance does not guarantee future results.
            </p>
            <p>Market data: IEX (U.S. equities), Alpaca (crypto). Quotes update every 15 minutes.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="3" fill="#ffffff" />
      <path d="M6 17.5 10.5 13l3.5 3 6-7" fill="none" stroke="#0b2341" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
