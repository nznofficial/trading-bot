"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Keeps the HUD live: re-fetches server data every `intervalMs` while the tab is visible,
 * and immediately when the tab becomes visible again. Data is cached ~60s server-side.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router, intervalMs]);
  return null;
}
