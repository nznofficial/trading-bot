/**
 * Original unit emblems (geometric mech heads), one per strategy.
 * UNIT-01 VANGUARD rides trends (SMA crossover); UNIT-02 RECOIL strikes on rebounds (RSI reversion).
 */
import { UNITS, type UnitId } from "@/lib/units";

export { UNITS, unitFor, type UnitId } from "@/lib/units";

export function UnitEmblem({ unit, size = 64 }: { unit: UnitId; size?: number }) {
  return unit === "sma_cross" ? <Vanguard size={size} /> : <Recoil size={size} />;
}

function Vanguard({ size }: { size: number }) {
  const { primary, secondary } = UNITS.sma_cross;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Unit-01 Vanguard emblem">
      <polygon points="32,2 60,18 60,46 32,62 4,46 4,18" fill="#0e0d14" stroke={primary} strokeWidth="1.5" />
      {/* Single forward horn */}
      <path d="M32 6 36 22 32 19 28 22Z" fill={secondary} />
      {/* Helmet */}
      <path d="M18 24 32 18 46 24 48 38 40 48H24L16 38Z" fill={primary} />
      {/* Visor and eyes */}
      <path d="M21 30h22l-3 6H24Z" fill="#0b0a10" />
      <path d="M24 32h6l-1 2h-5Z M34 32h6l-1 2h-5Z" fill={secondary} />
      {/* Jaw plates */}
      <path d="M26 40h12l-2 5h-8Z" fill="#0b0a10" opacity="0.6" />
      <path d="M16 38 11 30 18 26Z M48 38 53 30 46 26Z" fill={primary} opacity="0.7" />
    </svg>
  );
}

function Recoil({ size }: { size: number }) {
  const { primary, secondary } = UNITS.rsi_revert;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Unit-02 Recoil emblem">
      <polygon points="32,2 60,18 60,46 32,62 4,46 4,18" fill="#0e0d14" stroke={primary} strokeWidth="1.5" />
      {/* Twin swept fins */}
      <path d="M20 22 8 12 14 26Z M44 22 56 12 50 26Z" fill={secondary} />
      {/* Helmet */}
      <path d="M17 24 32 17 47 24 46 40 38 48H26L18 40Z" fill={primary} />
      {/* Quad optics */}
      <path d="M20 29h24v7H20Z" fill="#0b0a10" />
      <circle cx="25" cy="32.5" r="1.8" fill={secondary} />
      <circle cx="30" cy="32.5" r="1.8" fill={secondary} />
      <circle cx="34" cy="32.5" r="1.8" fill={secondary} />
      <circle cx="39" cy="32.5" r="1.8" fill={secondary} />
      {/* Grille */}
      <path d="M27 40h10M27 43h10" stroke="#0b0a10" strokeWidth="1.5" />
    </svg>
  );
}

/** Pilot crest used in the header. */
export function Crest({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <polygon points="16,1 30,9 30,23 16,31 2,23 2,9" fill="#0e0d14" stroke="#ffa41b" strokeWidth="1.5" />
      <path d="M8 20 13 14l4 3 7-8" fill="none" stroke="#a3ff3c" strokeWidth="2" strokeLinecap="square" />
      <circle cx="24" cy="9" r="1.6" fill="#8b5cf6" />
    </svg>
  );
}
