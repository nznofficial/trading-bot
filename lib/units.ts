/** Strategy → mech unit identity, shared by the UI (emblems) and server alerts. */
export const UNITS = {
  spy_core: {
    code: "UNIT-00",
    callsign: "Bastion",
    role: "Core defense",
    primary: "#38bdf8",
    secondary: "#3ce4ff",
  },
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
  news_drift: {
    code: "UNIT-03",
    callsign: "Herald",
    role: "Signal intercept",
    primary: "#f5c542",
    secondary: "#f2eee3",
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
