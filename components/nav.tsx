"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/positions", label: "Positions" },
  { href: "/trades", label: "Trades" },
  { href: "/strategies", label: "Strategies" },
  { href: "/runs", label: "Runs" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="-mb-px flex h-full gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
              active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink-2"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
