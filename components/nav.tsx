"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Summary" },
  { href: "/positions", label: "Positions" },
  { href: "/trades", label: "History" },
  { href: "/strategies", label: "Strategies" },
  { href: "/runs", label: "Activity log" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-6 overflow-x-auto">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`border-b-[3px] py-3 text-[15px] whitespace-nowrap transition-colors ${
              active ? "border-accent font-semibold text-ink" : "border-transparent text-ink-2 hover:text-accent"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
