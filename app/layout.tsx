import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Paper Trader",
  description: "Rule-based paper trading bot on Alpaca: live history, positions, and analytics.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="font-semibold tracking-tight">Paper Trader</span>
              <span className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-2">
                Paper
              </span>
            </div>
            <Nav />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="mx-auto w-full max-w-6xl px-4 py-6 text-xs text-muted">
          Simulated trading on Alpaca&apos;s paper account with real market data (IEX stock feed, Alpaca crypto feed). Not investment advice.
        </footer>
      </body>
    </html>
  );
}
