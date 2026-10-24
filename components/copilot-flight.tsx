"use client";

import { type RefObject, useEffect, useState } from "react";
import { play } from "@/lib/sfx";

const FLIGHT_MS = 1600;
const AFTERIMAGES = 4;

/**
 * Boost maneuver (FLIP): the dock has already been re-rendered in its new corner; this plays the trip
 * from `from` to there. Crouch, boost along an arc banking into the turn, overshoot, brake and land
 * with a squash. Thrusters fire opposite the direction of travel, the bust swaps to the launch
 * portrait in flight, and fading afterimages trail behind. Skipped entirely under reduced motion.
 */
export function fly(el: HTMLElement, from: DOMRect, reduced: boolean) {
  const to = el.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  if (reduced || Math.hypot(dx, dy) < 8) return;

  // Bank into the direction of travel (-dx), and arc up on the way.
  const bank = Math.max(-7, Math.min(7, -dx / 50));
  const lift = Math.min(48, Math.hypot(dx, dy) * 0.08);
  const frames = (fade = 1): Keyframe[] => [
    { offset: 0, transform: `translate(${dx}px, ${dy}px)`, opacity: fade },
    { offset: 0.14, transform: `translate(${dx}px, ${dy + 8}px) scale(0.96, 0.9)`, opacity: fade, easing: "cubic-bezier(.55,0,.8,.3)" },
    { offset: 0.48, transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) rotate(${bank}deg)`, opacity: fade, easing: "cubic-bezier(.15,.7,.3,1)" },
    { offset: 0.78, transform: `translate(${-dx * 0.04}px, ${-dy * 0.04}px) rotate(${-bank * 0.4}deg)`, opacity: fade * 0.6 },
    { offset: 0.9, transform: "translate(0, 4px) scale(1.03, 0.95)", opacity: fade * 0.3 },
    { offset: 1, transform: "none", opacity: fade === 1 ? 1 : 0 },
  ];

  // Exhaust points back toward where it came from, starting at the dock's edge in that direction.
  const angle = Math.atan2(dy, dx);
  const reach = Math.min(to.width / 2 / Math.abs(Math.cos(angle) || 1e-6), to.height / 2 / Math.abs(Math.sin(angle) || 1e-6));
  el.style.setProperty("--thrust-angle", `${angle}rad`);
  el.style.setProperty("--thrust-reach", `${reach}px`);
  el.dataset.boost = "";
  play("boost");

  for (let i = 1; i <= AFTERIMAGES; i++) {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-copilot");
    ghost.removeAttribute("aria-live");
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.classList.add("afterimage");
    document.body.appendChild(ghost);
    ghost
      .animate(frames(0.38 * (1 - i / (AFTERIMAGES + 1))), { duration: FLIGHT_MS, delay: i * 90, fill: "both" })
      .finished.catch(() => {})
      .finally(() => ghost.remove());
  }

  el.animate(frames(), { duration: FLIGHT_MS }).finished.then(
    () => {
      delete el.dataset.boost;
      play("land");
      // Touchdown: a flash on the frame and a shockwave under its feet.
      el.animate(
        [{ filter: "brightness(1.7) drop-shadow(0 0 18px rgba(255,164,27,.8))" }, { filter: "none" }],
        { duration: 420, easing: "ease-out" },
      );
      const ring = document.createElement("div");
      ring.className = "landing-ring";
      ring.setAttribute("aria-hidden", "true");
      const r = el.getBoundingClientRect();
      ring.style.left = `${r.left + r.width / 2}px`;
      ring.style.top = `${r.bottom - 6}px`;
      document.body.appendChild(ring);
      ring.addEventListener("animationend", () => ring.remove());
    },
    () => delete el.dataset.boost, // interrupted by a newer flight
  );
}

type Box = { l: number; t: number; r: number; b: number };
const box = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) };
};
const same = (a: Box | null, b: Box | null) => !!a && !!b && a.l === b.l && a.t === b.t && a.r === b.r && a.b === b.b;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Lock-on overlay: targeting brackets around the briefed element and a data-link line from the dock
 * to it. Follows scrolling, layout changes and the dock's own flight (rects include transforms).
 */
export function LockOn({
  target,
  dock,
  lockId,
  color = "var(--amber)",
}: {
  target: RefObject<HTMLElement | null>;
  dock: RefObject<HTMLElement | null>;
  lockId: number;
  color?: string;
}) {
  const [geo, setGeo] = useState<{ t: Box; d: Box } | null>(null);

  useEffect(() => {
    let raf = 0;
    let last: { t: Box; d: Box } | null = null;
    const tick = () => {
      const t = target.current;
      const d = dock.current;
      const next = t?.isConnected && d ? { t: box(t), d: box(d) } : null;
      if (!next !== !last || (next && last && (!same(next.t, last.t) || !same(next.d, last.d)))) {
        last = next;
        setGeo(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, dock]);

  if (!geo) return null;
  const { t, d } = geo;
  if (t.b < 0 || t.t > window.innerHeight || t.r < 0 || t.l > window.innerWidth) return null;

  // The link runs along the line between the two centers: from where it leaves the dock (the dock
  // sits above it) into the target, fading over the panel so its numbers stay readable, and ending
  // at the reticle that marks the target's center.
  const dc = { x: (d.l + d.r) / 2, y: (d.t + d.b) / 2 };
  const tc = { x: (t.l + t.r) / 2, y: (t.t + t.b) / 2 };
  const v = { x: tc.x - dc.x, y: tc.y - dc.y };
  /** Fraction of v from a box's center to its edge along v. */
  const exit = (hw: number, hh: number) => Math.min(v.x ? hw / Math.abs(v.x) : Infinity, v.y ? hh / Math.abs(v.y) : Infinity);
  const fa = exit((d.r - d.l) / 2, (d.b - d.t) / 2);
  const fb = exit((t.r - t.l) / 2, (t.b - t.t) / 2);
  const a = { x: dc.x + v.x * fa, y: dc.y + v.y * fa };
  const b = { x: tc.x - v.x * fb, y: tc.y - v.y * fb };
  const rr = clamp(Math.min(t.r - t.l, t.b - t.t) / 4, 4, 8);
  const len = Math.hypot(v.x, v.y);
  // Stop just short of the reticle ring.
  const stop = len ? 1 - (rr + 6) / len : 0;
  const e = { x: dc.x + v.x * stop, y: dc.y + v.y * stop };
  const linked = fa < stop && Math.hypot(e.x - a.x, e.y - a.y) > 12;
  // Where the line crosses into the target, as a fraction of the drawn segment (for the fade).
  const fadeAt = linked ? clamp((1 - fb - fa) / (stop - fa), 0, 1) : 0;
  const s = Math.min(16, (t.r - t.l) / 3, (t.b - t.t) / 2);
  const g = 4; // brackets sit just outside the element
  const brackets = [
    `M${t.l - g} ${t.t - g + s}V${t.t - g}H${t.l - g + s}`,
    `M${t.r + g - s} ${t.t - g}H${t.r + g}V${t.t - g + s}`,
    `M${t.r + g} ${t.b + g - s}V${t.b + g}H${t.r + g - s}`,
    `M${t.l - g + s} ${t.b + g}H${t.l - g}V${t.b + g - s}`,
  ];

  return (
    <svg aria-hidden className="lock-on pointer-events-none fixed inset-0 z-30 h-full w-full overflow-visible">
      <g key={lockId} className="lock-brackets" style={{ transformOrigin: `${tc.x}px ${tc.y}px` }}>
        {brackets.map((p) => (
          <path key={p.slice(0, 4)} d={p} fill="none" stroke={color} strokeWidth="2" />
        ))}
        <text x={t.l - g} y={t.t - g - 5} className="hud" fontSize="10" fill={color}>
          Lock
        </text>
        {/* Center reticle: ring, four ticks with a gap, and a pip. */}
        <g stroke={color} strokeWidth="1.5" fill="none">
          <circle cx={tc.x} cy={tc.y} r={rr} />
          <path
            d={`M${tc.x - rr - 5} ${tc.y}h4M${tc.x + rr + 1} ${tc.y}h4M${tc.x} ${tc.y - rr - 5}v4M${tc.x} ${tc.y + rr + 1}v4`}
          />
        </g>
        <circle cx={tc.x} cy={tc.y} r="1.6" fill={color} />
      </g>
      {linked && (
        <>
          <defs>
            <linearGradient id="lock-fade" gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={e.x} y2={e.y}>
              <stop offset={fadeAt} stopColor={color} stopOpacity="1" />
              <stop offset="1" stopColor={color} stopOpacity="0.3" />
            </linearGradient>
          </defs>
          {fa + fb < 1 && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeOpacity="0.25" strokeWidth="4" />}
          <line className="lock-link" x1={a.x} y1={a.y} x2={e.x} y2={e.y} stroke="url(#lock-fade)" strokeWidth="1.5" strokeDasharray="6 5" />
        </>
      )}
    </svg>
  );
}
