/** Strategy → mech unit identity, shared by the UI (emblems) and server alerts. */
export const UNITS = {
  sma_cross: {
    code: "UNIT-01",
    callsign: "Vanguard",
    role: "Trend assault",
    primary: "#8b5cf6",
    secondary: "#a3ff3c",
  },
  rsi_revert: {
    code: "UNIT-02",
    callsign: "Recoil",
    role: "Counter-strike",
    primary: "#ff3b4e",
    secondary: "#ffa41b",
  },
} as const;

export type UnitId = keyof typeof UNITS;

export function unitFor(strategy: string | null) {
  return strategy && strategy in UNITS ? UNITS[strategy as UnitId] : null;
}

export const unitName = (strategy: string | null) => {
  const u = unitFor(strategy);
  return u ? `${u.code} ${u.callsign}` : "Manual";
};
