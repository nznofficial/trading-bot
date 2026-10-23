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
    <nav className="-mx-1 flex gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`relative px-3 py-2 font-label text-[10px] tracking-[0.18em] whitespace-nowrap uppercase transition-colors ${
              active ? "text-neon" : "text-ink-2 hover:text-ink"
            }`}
          >
            {l.label}
            <span
              aria-hidden
              className={`absolute inset-x-3 -bottom-px h-px transition-opacity ${
                active ? "bg-neon opacity-100 shadow-[0_0_8px_var(--neon)]" : "opacity-0"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
