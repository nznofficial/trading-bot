"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { fly, LockOn } from "@/components/copilot-flight";
import { briefing, type BriefCtx, type Briefing } from "@/lib/briefings";
import { pickCorner, type Corner } from "@/lib/dock-placement";
import { COPILOT_STATES, copilotLine, copilotReport, type CopilotInput, type CopilotState } from "@/lib/copilot";
import { play } from "@/lib/sfx";

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

/**
 * Types its text out; remount (via key) to restart. Instant for reduced-motion users and on the server.
 * Screen readers get the whole line at once instead of every keystroke.
 */
function Typed({ text, instant, reserve = false }: { text: string; instant: boolean; reserve?: boolean }) {
  const [n, setN] = useState(instant ? text.length : 0);
  useEffect(() => {
    if (instant) return;
    const id = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(id), v) : v + 2)), 18);
    return () => clearInterval(id);
  }, [text, instant]);
  return (
    <>
      <span aria-hidden>
        {text.slice(0, instant ? text.length : n)}
        {/* `reserve` holds the final size from the start, so the dock doesn't grow while typing. */}
        {reserve && !instant && <span className="opacity-0">{text.slice(n)}</span>}
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

/** Clicks on these keep their own behavior; they never open a briefing. */
const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role=button], [role=tab], [contenteditable]";

type ActiveBrief = { page: string; seq: number } & Briefing;

/**
 * Click-to-brief: any element marked with `data-brief` (see lib/briefings.ts) opens JC-316's briefing
 * on click, or on Enter when focused. The innermost marked element wins, so a table row beats its panel.
 */
function useBriefings(page: string) {
  const [brief, setBrief] = useState<ActiveBrief | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const mark = (el: HTMLElement | null) => {
      targetRef.current?.removeAttribute("data-briefed");
      targetRef.current = el;
      el?.setAttribute("data-briefed", "");
    };
    const open = (el: HTMLElement) => {
      if (el === targetRef.current) {
        mark(null);
        setBrief(null);
        return;
      }
      let ctx: BriefCtx = {};
      try {
        ctx = JSON.parse(el.dataset.briefCtx ?? "{}");
      } catch {}
      const b = briefing(el.dataset.brief ?? "", ctx);
      if (!b) return;
      mark(el);
      play("click");
      setBrief((prev) => ({ ...b, page: window.location.pathname, seq: (prev?.seq ?? 0) + 1 }));
    };
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const t = e.target;
      if (!(t instanceof Element) || t.closest(INTERACTIVE) || t.closest("[data-copilot]")) return;
      if (window.getSelection()?.toString()) return; // selecting text, not targeting
      const el = t.closest<HTMLElement>("[data-brief]");
      if (el) open(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && targetRef.current) {
        mark(null);
        setBrief(null);
      } else if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.dataset.brief) {
        open(e.target);
      }
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const close = () => {
    targetRef.current?.removeAttribute("data-briefed");
    targetRef.current = null;
    setBrief(null);
  };
  // A briefing belongs to the page it was opened on; navigating away drops it.
  return { brief: brief && brief.page === page ? brief : null, close, targetRef };
}

const CORNER_CLASS: Record<Corner, string> = {
  br: "right-4 bottom-4",
  bl: "left-4 bottom-4",
  tr: "right-4 top-4",
  tl: "left-4 top-4",
};

/** Exhaust plumes behind the dock; only visible mid-flight (`data-boost`), aimed by --thrust-angle. */
function Thrusters() {
  return (
    <span aria-hidden className="thrusters">
      <span className="plume" />
      <span className="plume plume-2" />
    </span>
  );
}

/** JC-316's launch portrait (optics blazing, thrusters lit), swapped in while boosting. */
function LaunchBust() {
  return (
    <Image
      src="/art/jc316-bust-launch.webp"
      alt=""
      width={256}
      height={256}
      className="bust-launch pointer-events-none absolute inset-0 size-full object-contain"
    />
  );
}

function BriefSection({ label, tone, children }: { label: string; tone: string; children: ReactNode }) {
  return (
    <div>
      <div className={`hud text-[10px] ${tone}`}>{label}</div>
      <p className="mt-0.5 text-[13px] leading-snug text-ink">{children}</p>
    </div>
  );
}

/**
 * JC-316, the copilot: a corner companion on every page. State and line come from live data
 * (lib/copilot.ts); `?copilot=<state>` forces a state for previews.
 */
export function CopilotDock({ data }: { data: Omit<CopilotInput, "page"> }) {
  const page = usePathname();
  const params = useSearchParams();
  const firstVisit = useFirstVisit();
  const { brief, close, targetRef } = useBriefings(page);
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

  // Evasive maneuvers: while briefing, the dock moves to whichever corner hides the least of the
  // target, flying there (see fly()). It returns home to bottom-right when the briefing closes.
  const [corner, setCorner] = useState<Corner>("br");
  const cornerRef = useRef<Corner>("br");
  const dockRef = useRef<HTMLElement | null>(null);
  const setDock = useCallback((el: HTMLElement | null) => {
    dockRef.current = el;
  }, []);
  const departure = useRef<DOMRect | null>(null);
  const moveTo = useCallback((c: Corner) => {
    if (c === cornerRef.current) return;
    departure.current = dockRef.current?.getBoundingClientRect() ?? null;
    cornerRef.current = c;
    setCorner(c);
  }, []);
  const place = useCallback(() => {
    const t = targetRef.current;
    const d = dockRef.current;
    if (!t?.isConnected || !d) return;
    const view = { w: window.innerWidth, h: window.innerHeight };
    moveTo(pickCorner(t.getBoundingClientRect(), { w: d.offsetWidth, h: d.offsetHeight }, view, cornerRef.current));
  }, [moveTo, targetRef]);

  const seq = brief?.seq ?? 0;
  const briefing = !!brief;
  useEffect(() => {
    // Next frame: the briefing has rendered at full size, so the dock can be measured.
    const id = requestAnimationFrame(() => (briefing ? place() : moveTo("br")));
    return () => cancelAnimationFrame(id);
  }, [seq, briefing, place, moveTo]);
  useEffect(() => {
    if (!briefing) return;
    let t: ReturnType<typeof setTimeout>;
    const settle = () => {
      clearTimeout(t);
      t = setTimeout(place, 220); // after scrolling stops, not on every frame
    };
    window.addEventListener("scroll", settle, { passive: true });
    window.addEventListener("resize", settle);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", settle);
      window.removeEventListener("resize", settle);
    };
  }, [briefing, place]);
  useLayoutEffect(() => {
    const from = departure.current;
    departure.current = null;
    if (from && dockRef.current) fly(dockRef.current, from, reduced);
  }, [corner, reduced]);

  const at = CORNER_CLASS[corner];

  if (brief) {
    return (
      <>
        <LockOn target={targetRef} dock={dockRef} lockId={brief.seq} />
  <aside
          ref={setDock}
          data-copilot
          aria-live="polite"
          aria-label={`JC-316 briefing: ${brief.title}`}
          className={`fixed ${at} z-40 w-[min(440px,calc(100vw-2rem))]`}
        >
          <Thrusters />
          <div className="frame frame-amber">
            <div className="frame-body relative flex gap-3 p-3 pr-4">
              <div className="relative size-20 shrink-0 self-start drop-shadow-[0_0_16px_rgba(34,211,238,0.35)] sm:size-24">
                <Image src="/art/jc316-bust-thinking.webp" alt="JC-316, analyzing" width={192} height={192} loading="eager" className="bust-main size-full object-contain" />
                <LaunchBust />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 pr-6">
                  <span className="hud text-[12px] text-amber">JC-316 · Briefing</span>
                  <span className="hud border border-cyan/50 px-1.5 text-[10px] text-cyan">
                    <span className="boost-off">Scanning</span>
                    <span className="boost-on">Evasive</span>
                  </span>
                </div>
                <h2 className="mt-1 font-title text-[19px] leading-tight font-extrabold text-ink">{brief.title}</h2>
                <div className="mt-2 grid max-h-[min(46vh,360px)] gap-2.5 overflow-y-auto pr-1">
                  <BriefSection label="What it is" tone="text-muted">
                    {brief.what}
                  </BriefSection>
                  <BriefSection label="Reading now" tone="text-sync">
                    <Typed key={brief.seq} text={brief.now} instant={reduced} reserve />
                  </BriefSection>
                  <BriefSection label="Pilot's note" tone="text-amber">
                    {brief.note}
                  </BriefSection>
                </div>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close briefing"
                className="hud absolute top-1.5 right-2 px-1 text-[15px] text-muted hover:text-ink"
              >
                ×
              </button>
            </div>
          </div>
        </aside>
      </>
    );
  }

  if (!open) {
    return (
      <button
        ref={setDock}
        type="button"
        data-copilot
        onClick={() => writePref("open")}
        aria-label={`Open JC-316 copilot (${STATE_LABEL[report.state]})`}
        className={`frame fixed ${at} z-40 size-16 ${report.state === "alert" || report.state === "damaged" ? "frame-amber" : "frame-hot"}`}
      >
        <span className="frame-body block overflow-hidden">
          <Image src={src} alt="" width={128} height={128} className="size-full object-cover" />
        </span>
      </button>
    );
  }

  return (
    <aside
      ref={setDock}
      data-copilot
      aria-live="polite"
      aria-label="JC-316 copilot"
      className={`fixed ${at} z-40 w-[min(380px,calc(100vw-2rem))]`}
    >
      <Thrusters />
      <div className={`frame ${report.state === "alert" || report.state === "damaged" ? "frame-amber" : "frame-hot"}`}>
        <div className="frame-body relative flex items-end gap-3 p-3 pr-4">
          {/* Stays inside the frame: the chamfer's clip-path would cut off anything overflowing it. */}
          <div className="relative size-28 shrink-0 drop-shadow-[0_0_16px_rgba(139,92,246,0.45)]">
            <Image src={src} alt={`JC-316, ${STATE_LABEL[report.state]}`} width={256} height={256} priority className="bust-main size-full object-contain" />
            <LaunchBust />
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
            <p className="hud mt-1 text-[10px] text-muted">Click any panel and I&apos;ll brief you</p>
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
