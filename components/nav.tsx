"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { play } from "@/lib/sfx";

const LINKS = [
  { href: "/", code: "01", label: "Bridge" },
  { href: "/positions", code: "02", label: "Engagements" },
  { href: "/trades", code: "03", label: "Combat log" },
  { href: "/strategies", code: "04", label: "Hangar" },
  { href: "/runs", code: "05", label: "Sorties" },
  { href: "/simulator", code: "06", label: "Simulator" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1.5 overflow-x-auto py-2">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            onClick={() => play("click")}
            className={`hud slant shrink-0 border px-4 py-1.5 text-[14px] whitespace-nowrap transition-colors ${
              active
                ? "border-amber bg-amber text-[#0b0a10]"
                : "border-line-2 bg-surface/60 text-ink-2 hover:border-amber/60 hover:text-ink"
            }`}
          >
            <span className="unslant inline-flex items-baseline gap-2">
              <span className={`text-[11px] ${active ? "text-[#0b0a10]/70" : "text-muted"}`}>{l.code}</span>
              {l.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
