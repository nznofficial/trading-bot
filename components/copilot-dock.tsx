"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COPILOT_STATES, copilotLine, copilotReport, type CopilotInput, type CopilotState } from "@/lib/copilot";

const STATE_LABEL: Record<CopilotState, string> = {
  alert: "Alert",
  thinking: "Analyzing",
  victory: "Victory",
  damaged: "Damaged",
  standby: "Standby",
  active: "Active",
  greeting: "Online",
};

const STATE_TONE: Record<CopilotState, string> = {
  alert: "text-alert border-alert/60",
  thinking: "text-cyan border-cyan/50",
  victory: "text-sync border-sync/60",
  damaged: "text-alert border-alert/60",
  standby: "text-ink-2 border-line-2",
  active: "text-sync border-sync/50",
  greeting: "text-amber border-amber/60",
};

const PREF = "pt-copilot";
const subscribe = (cb: () => void) => {
  window.addEventListener("pt-copilot", cb);
  return () => window.removeEventListener("pt-copilot", cb);
};
const readPref = () => {
  try {
    return localStorage.getItem(PREF);
  } catch {
    return null;
  }
};
const writePref = (v: "open" | "min") => {
  try {
    localStorage.setItem(PREF, v);
  } catch {}
  window.dispatchEvent(new Event("pt-copilot"));
};

const noSubscribe = () => () => {};

/** Read once per page load: is this the first view of the browser session? (Server: no.) */
let firstVisitCache: boolean | null = null;
const readFirstVisit = () => {
  if (firstVisitCache !== null) return firstVisitCache;
  try {
    firstVisitCache = !sessionStorage.getItem("pt-greeted");
    sessionStorage.setItem("pt-greeted", "1");
  } catch {
    firstVisitCache = false;
  }
  return firstVisitCache;
};
const useFirstVisit = () => useSyncExternalStore(noSubscribe, readFirstVisit, () => false);
const useReducedMotion = () =>
  useSyncExternalStore(noSubscribe, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true);

/** Types its text out; remount (via key) to restart. Instant for reduced-motion users and on the server. */
function Typed({ text, instant }: { text: string; instant: boolean }) {
  const [n, setN] = useState(instant ? text.length : 0);
  useEffect(() => {
    if (instant) return;
    const id = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(id), v) : v + 2)), 18);
    return () => clearInterval(id);
  }, [text, instant]);
  return <>{text.slice(0, instant ? text.length : n)}</>;
}

/**
 * JC-316, the copilot: a corner companion on every page. State and line come from live data
 * (lib/copilot.ts); `?copilot=<state>` forces a state for previews.
 */
export function CopilotDock({ data }: { data: Omit<CopilotInput, "page"> }) {
  const page = usePathname();
  const params = useSearchParams();
  const firstVisit = useFirstVisit();
  const [greetingDone, setGreetingDone] = useState(false);
  useEffect(() => {
    if (!firstVisit) return;
    const id = setTimeout(() => setGreetingDone(true), 7000);
    return () => clearTimeout(id);
  }, [firstVisit]);

  const input: CopilotInput = { ...data, page };
  const forced = params.get("copilot") as CopilotState | null;
  const report = forced && COPILOT_STATES.includes(forced)
    ? { state: forced, line: copilotLine(forced, input) }
    : firstVisit && !greetingDone
      ? { state: "greeting" as const, line: copilotLine("greeting", input) }
      : copilotReport(input);

  // Default: open on desktop, minimized on small screens; the user's choice wins after that.
  const pref = useSyncExternalStore(subscribe, readPref, () => "open");
  const smallDefault = useSyncExternalStore(noSubscribe, () => window.matchMedia("(max-width: 640px)").matches, () => false);
  const reduced = useReducedMotion();
  const open = pref ? pref === "open" : !smallDefault;
  const src = `/art/jc316-bust-${report.state}.webp`;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => writePref("open")}
        aria-label={`Open JC-316 copilot (${STATE_LABEL[report.state]})`}
        className={`frame fixed right-4 bottom-4 z-40 size-16 ${report.state === "alert" || report.state === "damaged" ? "frame-amber" : "frame-hot"}`}
      >
        <span className="frame-body block overflow-hidden">
          <Image src={src} alt="" width={128} height={128} className="size-full object-cover" />
        </span>
      </button>
    );
  }

  return (
    <aside
      aria-live="polite"
      aria-label="JC-316 copilot"
      className="fixed right-4 bottom-4 z-40 w-[min(380px,calc(100vw-2rem))]"
    >
      <div className={`frame ${report.state === "alert" || report.state === "damaged" ? "frame-amber" : "frame-hot"}`}>
        <div className="frame-body relative flex items-end gap-3 p-3 pr-4">
          {/* Stays inside the frame: the chamfer's clip-path would cut off anything overflowing it. */}
          <div className="relative size-28 shrink-0 drop-shadow-[0_0_16px_rgba(139,92,246,0.45)]">
            <Image src={src} alt={`JC-316, ${STATE_LABEL[report.state]}`} width={256} height={256} priority className="size-full object-contain" />
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex items-center justify-between gap-2">
              <span className="hud text-[12px] text-amber">JC-316 · Copilot</span>
              <span className={`hud border px-1.5 text-[10px] ${STATE_TONE[report.state]}`}>{STATE_LABEL[report.state]}</span>
            </div>
            <p className="mt-1.5 min-h-[3.6em] text-[13px] leading-snug text-ink">
              <Typed key={report.line} text={report.line} instant={reduced} />
              <span aria-hidden className="blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-sync" />
            </p>
          </div>
          <button
            type="button"
            onClick={() => writePref("min")}
            aria-label="Minimize copilot"
            className="hud absolute top-1.5 right-2 text-[12px] text-muted hover:text-ink"
          >
            —
          </button>
        </div>
      </div>
    </aside>
  );
}
