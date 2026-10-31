"use client";

import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChatPanel, useChat } from "@/components/copilot-chat";
import { fly, LockOn } from "@/components/copilot-flight";
import { briefing, type BriefCtx, type Briefing, type Speaker } from "@/lib/briefings";
import { ART } from "@/components/art";
import { CORNERS, pickCorner, type Corner } from "@/lib/dock-placement";
import { COPILOT_STATES, copilotLine, copilotReport, type CopilotInput, type CopilotState } from "@/lib/copilot";
import { play } from "@/lib/sfx";
import { sayBriefing, stopVoice } from "@/lib/voice-player";
import { UNITS } from "@/lib/units";

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

/** Home corner, chosen by dragging the dock; shares the pt-copilot change event. */
const HOME = "pt-copilot-home";
const readHome = (): Corner => {
  try {
    const v = localStorage.getItem(HOME);
    return CORNERS.includes(v as Corner) ? (v as Corner) : "br";
  } catch {
    return "br";
  }
};
const writeHome = (c: Corner) => {
  try {
    localStorage.setItem(HOME, c);
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
        stopVoice();
        play("brief-close");
        return;
      }
      let ctx: BriefCtx = {};
      try {
        ctx = JSON.parse(el.dataset.briefCtx ?? "{}");
      } catch {}
      const b = briefing(el.dataset.brief ?? "", ctx);
      if (!b) return;
      mark(el);
      // Lock-on chirp, then the speaker keys their comms and (if Voice is on) says their line and the reading.
      play("lock");
      setTimeout(() => play(`voice-${b.speaker}`), 320);
      const id = el.dataset.brief ?? "";
      setTimeout(() => sayBriefing(b.speaker, b.quote, Date.now(), id, ctx), 650);
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
        stopVoice();
        play("brief-close");
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

  /** Close the briefing (with the lock-release cue unless something else is about to sound). */
  const close = (quiet = false) => {
    stopVoice();
    if (!quiet) play("brief-close");
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

/**
 * Who's talking. Unit-owned components (a position, trade, unit card, targeting call...) are briefed by
 * that wingman, in its colors and with its own key art; everything else by JC-316.
 */
const SPEAKERS: Record<Speaker, { name: string; code: string; role: string; art: string; frame: string; accent: string }> = {
  jc316: { name: "JC-316", code: "JC-316", role: "Cmd frame", art: ART.jc316Keyart, frame: "var(--amber)", accent: "var(--amber)" },
  sma_cross: {
    name: UNITS.sma_cross.callsign,
    code: UNITS.sma_cross.code,
    role: UNITS.sma_cross.role,
    art: ART.vanguardKeyart,
    frame: UNITS.sma_cross.primary,
    accent: UNITS.sma_cross.secondary,
  },
  spy_core: {
    name: UNITS.spy_core.callsign,
    code: UNITS.spy_core.code,
    role: UNITS.spy_core.role,
    art: ART.bastionKeyart,
    frame: UNITS.spy_core.primary,
    accent: UNITS.spy_core.secondary,
  },
  rsi_revert: {
    name: UNITS.rsi_revert.callsign,
    code: UNITS.rsi_revert.code,
    role: UNITS.rsi_revert.role,
    art: ART.recoilKeyart,
    frame: UNITS.rsi_revert.primary,
    accent: UNITS.rsi_revert.secondary,
  },
  news_drift: {
    name: UNITS.news_drift.callsign,
    code: UNITS.news_drift.code,
    role: UNITS.news_drift.role,
    art: ART.heraldKeyart,
    frame: UNITS.news_drift.primary,
    accent: UNITS.news_drift.secondary,
  },
};

/**
 * Full-length speaker art for the briefing: a tall framed ID panel (the key art, hangar and all) that
 * doubles as the drag handle. Mid-flight it lights up with speed lines (see globals.css).
 */
function Portrait({ who, className = "" }: { who: (typeof SPEAKERS)[Speaker]; className?: string }) {
  return (
    // Fixed size (not stretched to the text), so the art stays put from one briefing to the next.
    <div
      data-drag-handle
      title="Drag me to any corner"
      className={`portrait relative h-[184px] w-20 shrink-0 self-start overflow-hidden border border-line-2 sm:h-[264px] sm:w-32 ${className}`}
    >
      <Image src={who.art} alt={`${who.name}, full frame`} fill sizes="128px" loading="eager" className="object-cover object-[50%_30%]" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#08070c]/85 via-transparent via-40% to-transparent" />
      <div aria-hidden className="speed-lines absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5">
        <div className="hud text-[11px] leading-none" style={{ color: who.accent }}>
          {who.name}
        </div>
        <div className="hud mt-0.5 text-[9px] leading-none text-muted">
          <span className="boost-off">{who.role}</span>
          <span className="boost-on text-sync">Boost</span>
        </div>
      </div>
    </div>
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
  const chat = useChat();
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
  // target, flying there (see fly()). It flies back to its home corner when the briefing closes.
  // Home is bottom-right until the user drags the dock somewhere else.
  const home = useSyncExternalStore(subscribe, readHome, () => "br" as const);
  const [corner, setCorner] = useState<Corner>("br");
  const cornerRef = useRef<Corner>("br");
  const dockRef = useRef<HTMLElement | null>(null);
  const setDock = useCallback((el: HTMLElement | null) => {
    dockRef.current = el;
  }, []);
  const departure = useRef<DOMRect | null>(null);
  const reducedRef = useRef(reduced);
  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);
  /** Fly to `c`, from `from` (default: where the dock is now; null: jump without flying). */
  const moveTo = useCallback((c: Corner, from?: DOMRect | null) => {
    const start = from === undefined ? (dockRef.current?.getBoundingClientRect() ?? null) : from;
    if (c === cornerRef.current) {
      // Same corner (e.g. dropped back where it was): fly back from the drop point, if any.
      if (start && dockRef.current) fly(dockRef.current, start, reducedRef.current);
      return;
    }
    departure.current = start;
    cornerRef.current = c;
    setCorner(c);
  }, []);
  // Dragged during a briefing: respect the pilot's choice until the next briefing.
  const manual = useRef(false);
  const place = useCallback(() => {
    const t = targetRef.current;
    const d = dockRef.current;
    if (manual.current || !t?.isConnected || !d) return;
    const view = { w: window.innerWidth, h: window.innerHeight };
    moveTo(pickCorner(t.getBoundingClientRect(), { w: d.offsetWidth, h: d.offsetHeight }, view, cornerRef.current));
  }, [moveTo, targetRef]);

  const seq = brief?.seq ?? 0;
  const briefing = !!brief;
  useEffect(() => {
    if (!seq) return;
    manual.current = false;
    // Next frame: the briefing has rendered at full size, so the dock can be measured.
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [seq, place]);
  const synced = useRef(false);
  useEffect(() => {
    if (briefing) return;
    const id = requestAnimationFrame(() => {
      // The first sync after load jumps straight to the saved home instead of flying there.
      moveTo(home, synced.current ? undefined : null);
      synced.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [briefing, home, moveTo]);
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

  // Drag to reposition: grab a [data-drag-handle] (the portrait), drop near any corner, and that
  // corner becomes home. The dock follows the pointer, then boosts into the corner from the drop point.
  const [drag, setDrag] = useState<{ nearest: Corner; w: number; h: number } | null>(null);
  const justDragged = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const el = dockRef.current;
    if (!el || e.button !== 0 || !(e.target as Element).closest("[data-drag-handle]")) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const r0 = el.getBoundingClientRect();
    let dragging = false;
    let nearest: Corner = cornerRef.current;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!dragging) {
        if (Math.hypot(dx, dy) < 6) return;
        dragging = true;
        el.getAnimations().forEach((a) => a.cancel());
        play("pickup");
        delete el.dataset.boost;
        el.dataset.dragging = "";
      }
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-6, Math.min(6, dx / 40))}deg)`;
      const cx = r0.left + r0.width / 2 + dx;
      const cy = r0.top + r0.height / 2 + dy;
      nearest = `${cy < window.innerHeight / 2 ? "t" : "b"}${cx < window.innerWidth / 2 ? "l" : "r"}` as Corner;
      setDrag({ nearest, w: r0.width, h: r0.height });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      const from = el.getBoundingClientRect();
      el.style.transform = "";
      delete el.dataset.dragging;
      justDragged.current = true;
      setTimeout(() => (justDragged.current = false), 0);
      setDrag(null);
      if (briefing) manual.current = true;
      play("drop");
      writeHome(nearest);
      moveTo(nearest, from);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  // A drag ends with a click on whatever was under the pointer; swallow it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!justDragged.current) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const dragProps = { onPointerDown, onClickCapture };
  const zones = drag && (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[35]">
      {CORNERS.map((c) => (
        <div
          key={c}
          className={`dock-zone fixed ${CORNER_CLASS[c]} ${c === drag.nearest ? "dock-zone-hot" : ""}`}
          style={{ width: drag.w, height: drag.h }}
        >
          {c === drag.nearest && <span className="hud absolute top-2 left-3 text-[11px] text-amber">Set home</span>}
        </div>
      ))}
    </div>
  );

  const at = CORNER_CLASS[corner];

  if (brief) {
    const who = SPEAKERS[brief.speaker];
    const jc = brief.speaker === "jc316";
    return (
      <>
        <LockOn target={targetRef} dock={dockRef} lockId={brief.seq} color={who.frame} />
        {zones}
        <aside
          ref={setDock}
          {...dragProps}
          data-copilot
          aria-live="polite"
          aria-label={`${who.name} briefing: ${brief.title}`}
          className={`fixed ${at} z-40 w-[min(440px,calc(100vw-2rem))]`}
        >
          <Thrusters />
          <div className="frame" style={{ "--frame-line": who.frame } as React.CSSProperties}>
            <div className="frame-body relative flex gap-3 p-3 pr-4">
              <Portrait who={who} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 pr-6">
                  <span className="hud text-[12px]" style={{ color: who.accent }}>
                    {jc ? "JC-316" : `${who.code} ${who.name}`} · Briefing
                  </span>
                  <span className="hud border border-cyan/50 px-1.5 text-[10px] text-cyan">
                    <span className="boost-off">Scanning</span>
                    <span className="boost-on">Evasive</span>
                  </span>
                </div>
                <h2 className="mt-1 font-title text-[19px] leading-tight font-extrabold text-ink">{brief.title}</h2>
                {brief.quote && (
                  <p className="mt-1.5 border-l-2 pl-2 text-[13px] leading-snug text-ink-2 italic" style={{ borderColor: who.frame }}>
                    “{brief.quote}”
                  </p>
                )}
                <div className="mt-2 grid max-h-[min(46vh,360px)] gap-2.5 overflow-y-auto pr-1">
                  <BriefSection label="What it is" tone="text-muted">
                    {brief.what}
                  </BriefSection>
                  <BriefSection label="Reading now" tone="text-sync">
                    <Typed key={brief.seq} text={brief.now} instant={reduced} reserve />
                  </BriefSection>
                  <BriefSection label={jc ? "Pilot's note" : `${who.name}'s note`} tone="text-amber">
                    {brief.note}
                  </BriefSection>
                  <button
                    type="button"
                    onClick={() => {
                      chat.ask(`Tell me more about "${brief.title}".`);
                      close(true);
                    }}
                    className="hud justify-self-start text-[11px] text-amber hover:underline"
                  >
                    Ask JC-316 about this ▸
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => close()}
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

  if (chat.open) {
    return (
      <>
        {zones}
        <aside
          ref={setDock}
          {...dragProps}
          data-copilot
          aria-label="JC-316 comms"
          className={`fixed ${at} z-40 w-[min(440px,calc(100vw-2rem))]`}
        >
          <Thrusters />
          <div className="frame frame-amber">
            <div className="frame-body relative flex gap-3 p-3 pr-4">
              {/* Phones: no side portrait (the chat needs the width); a small avatar sits in the header. */}
              <Portrait who={SPEAKERS.jc316} className="hidden sm:block" />
              <ChatPanel
                chat={chat}
                header={
                  <div className="flex items-center gap-2 pr-6">
                    <span data-drag-handle className="relative size-8 shrink-0 overflow-hidden border border-line-2 sm:hidden">
                      <Image src={ART.jc316Keyart} alt="" fill sizes="32px" className="object-cover object-[50%_12%]" />
                    </span>
                    <span className="hud text-[12px] text-amber">JC-316 · Comms</span>
                    <span className="hud border border-sync/50 px-1.5 text-[10px] text-sync">
                      <span className="boost-off">{chat.busy ? "Receiving" : "Channel open"}</span>
                      <span className="boost-on">Evasive</span>
                    </span>
                  </div>
                }
              />
              <button
                type="button"
                onClick={chat.close}
                aria-label="Close comms"
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
      <>
        {zones}
        <button
          ref={setDock}
          {...dragProps}
          data-drag-handle
          type="button"
          data-copilot
          onClick={() => {
            play("powerup");
            writePref("open");
          }}
          aria-label={`Open JC-316 copilot (${STATE_LABEL[report.state]})`}
          className={`fixed ${at} z-40 size-16`}
        >
          {/* The chamfer lives on an inner span: .frame sets position: relative, which would unpin a fixed button. */}
          <span className={`frame block size-full ${report.state === "alert" || report.state === "damaged" ? "frame-amber" : "frame-hot"}`}>
            <span className="frame-body block overflow-hidden">
              <Image src={src} alt="" width={128} height={128} className="size-full object-cover" />
            </span>
          </span>
        </button>
      </>
    );
  }

  return (
    <>
      {zones}
      <aside
        ref={setDock}
        {...dragProps}
        data-copilot
        aria-live="polite"
        aria-label="JC-316 copilot"
        className={`fixed ${at} z-40 w-[min(380px,calc(100vw-2rem))]`}
      >
        <Thrusters />
        <div className={`frame ${report.state === "alert" || report.state === "damaged" ? "frame-amber" : "frame-hot"}`}>
          <div className="frame-body relative flex items-end gap-3 p-3 pr-4">
            {/* Stays inside the frame: the chamfer's clip-path would cut off anything overflowing it. */}
            <div data-drag-handle title="Drag me to any corner" className="relative size-28 shrink-0 drop-shadow-[0_0_16px_rgba(139,92,246,0.45)]">
              <Image src={src} alt={`JC-316, ${STATE_LABEL[report.state]}`} width={256} height={256} priority className="bust-main size-full object-contain" />
              <LaunchBust />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center justify-between gap-2">
                <span className="hud text-[12px] text-amber">JC-316 · Copilot</span>
                {/* The status chip doubles as the minimize control: hover/focus flips it to "Minimize". */}
                <button
                  type="button"
                  onClick={() => {
                    play("powerdown");
                    writePref("min");
                  }}
                  aria-label={`Minimize JC-316 (status: ${STATE_LABEL[report.state]})`}
                  title="Minimize"
                  className={`group hud shrink-0 border px-1.5 text-[10px] transition-colors hover:border-amber hover:text-amber focus-visible:border-amber focus-visible:text-amber ${STATE_TONE[report.state]}`}
                >
                  <span className="group-hover:hidden group-focus-visible:hidden">
                    {STATE_LABEL[report.state]}
                    <span aria-hidden className="touch-caret ml-1">
                      ▾
                    </span>
                  </span>
                  <span aria-hidden className="hidden group-hover:inline group-focus-visible:inline">
                    Minimize ▾
                  </span>
                </button>
              </div>
              <p className="mt-1.5 min-h-[3.6em] text-[13px] leading-snug text-ink">
                <Typed key={report.line} text={report.line} instant={reduced} />
                <span aria-hidden className="blink ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-sync" />
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="hud text-[10px] text-muted">Click any panel for a briefing · drag me anywhere</p>
                <button
                  type="button"
                  onClick={() => chat.ask("")}
                  className="hud shrink-0 border border-amber/60 px-2 py-0.5 text-[11px] text-amber hover:bg-amber/10"
                >
                  Comms ▸
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
