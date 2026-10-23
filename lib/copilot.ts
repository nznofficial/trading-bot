import { pct, signedPct, signedUsd } from "./format";
import { unitFor } from "./units";

/** JC-316's reactive states; each maps to a bust portrait in public/art. */
export type CopilotState = "alert" | "thinking" | "victory" | "damaged" | "standby" | "active" | "greeting";

export const COPILOT_STATES: CopilotState[] = ["alert", "thinking", "victory", "damaged", "standby", "active", "greeting"];

export type CopilotInput = {
  page: string;
  paused: boolean;
  marketOpen: boolean;
  /** "in 7h 12m"-style phrase, already formatted. */
  nextOpenIn: string | null;
  lastRun: { id: number; status: string; error: string | null } | null;
  dayPnl: number;
  dayPnlPct: number;
  currentDrawdown: number;
  equity: number;
  streak: number;
  positions: { symbol: string; unrealizedPl: number; strategy: string }[];
  bigWin: { symbol: string; pnl: number; returnPct: number; strategy: string } | null;
};

export type CopilotReport = { state: CopilotState; line: string };

/** Thresholds for the "damaged" state. */
export const DAMAGE = { dayPct: -0.01, drawdown: -0.05 };

/**
 * Pick JC-316's state from live data. Priority: a failure always wins; then page context (the
 * simulator); then the day's story (big win, damage); then market status.
 */
export function copilotState(i: CopilotInput): CopilotState {
  if (i.lastRun?.status === "error") return "alert";
  if (i.page.startsWith("/simulator")) return "thinking";
  if (i.bigWin) return "victory";
  if (i.dayPnlPct <= DAMAGE.dayPct || i.currentDrawdown <= DAMAGE.drawdown) return "damaged";
  if (i.paused || (!i.marketOpen && i.positions.length === 0)) return "standby";
  return "active";
}

const unitCall = (strategy: string) => {
  const u = unitFor(strategy);
  return u ? `${u.callsign}` : "Manual control";
};

/** Line templates. Every number shown is formatted from the input, never computed here. */
const LINES: Record<CopilotState, ((i: CopilotInput) => string)[]> = {
  alert: [
    (i) => `Pilot, sortie #${i.lastRun?.id} aborted. ${short(i.lastRun?.error)} Check the Sorties log.`,
    (i) => `Warning: last sortie failed. ${short(i.lastRun?.error)} Holding position until it clears.`,
    () => `Systems fault detected. I've logged it in Sorties. Standing by for your orders.`,
  ],
  thinking: [
    () => `Simulation deck online. Feed me parameters and I'll replay the year bar by bar.`,
    () => `Running the numbers, pilot. Remember: tune on the past, judge on what the tune never saw.`,
    () => `Every sortie in here is free. Out there, fees bite. Simulate first.`,
    () => `Wireframe targets loaded. No look-ahead, no shortcuts.`,
  ],
  // Victory is only chosen when bigWin exists; the fallback keeps forced previews from breaking.
  victory: [
    (i) =>
      i.bigWin
        ? `Target neutralized: ${i.bigWin.symbol}, ${signedUsd(i.bigWin.pnl)} (${signedPct(i.bigWin.returnPct)}). ${unitCall(i.bigWin.strategy)} delivered.`
        : `Target neutralized. Good work, pilot.`,
    (i) => (i.bigWin ? `Clean hit on ${i.bigWin.symbol}, pilot. ${signedPct(i.bigWin.returnPct)} banked.` : `Clean hit, pilot.`),
    (i) =>
      i.bigWin
        ? `${unitCall(i.bigWin.strategy)} reports ${i.bigWin.symbol} closed at ${signedUsd(i.bigWin.pnl)}. Good work.`
        : `Wingmen report a clean engagement.`,
  ],
  damaged: [
    (i) => `Taking damage, pilot. Day at ${signedUsd(i.dayPnl)} (${signedPct(i.dayPnlPct)}). Stops are holding.`,
    (i) => `Armor integrity ${pct(1 + i.currentDrawdown, 1)}, ${pct(-i.currentDrawdown, 1)} off peak. We ride it out by the rules.`,
    (i) => `Rough sortie: ${signedPct(i.dayPnlPct)} today. The −3% halt is armed if it gets worse.`,
  ],
  standby: [
    (i) =>
      i.paused
        ? `Units on hold by your order, pilot. Resume from the Sorties console when ready.`
        : `NYSE is offline${i.nextOpenIn ? `; activation ${i.nextOpenIn}` : ""}. Holding standby.`,
    (i) => `Quiet skies. Frame value ${usdShort(i.equity)}. I'll wake the wingmen at the bell.`,
    () => `Standing watch. Every fifteen minutes, I check the board.`,
  ],
  active: [
    (i) => {
      const p = top(i.positions);
      return p
        ? `${unitCall(p.strategy)} holding ${p.symbol}, ${signedUsd(p.unrealizedPl)}. Stops armed, pilot.`
        : `Market's live. Scanning ten targets every fifteen minutes.`;
    },
    (i) => `${i.positions.length} engagement${i.positions.length === 1 ? "" : "s"} open. Day at ${signedUsd(i.dayPnl)}.`,
    (i) => (i.streak > 1 ? `Combo at ${i.streak}. Don't get greedy; the rules don't.` : `Eyes on the board. No signal, no shot.`),
    () => `Vanguard hunts trends, Recoil catches dips. I keep them honest.`,
  ],
  greeting: [
    () => `JC-316 online. Welcome aboard, pilot.`,
    () => `Sync confirmed. All units reporting. Welcome back.`,
  ],
};

const short = (s: string | null | undefined) => (s ? `${s.slice(0, 90)}${s.length > 90 ? "…" : ""}` : "");
const usdShort = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const top = (ps: CopilotInput["positions"]) =>
  ps.reduce<CopilotInput["positions"][number] | null>((b, p) => (!b || Math.abs(p.unrealizedPl) > Math.abs(b.unrealizedPl) ? p : b), null);

/** Deterministic line choice: rotates with each sortie so it changes every 15 minutes, not every render. */
export function copilotLine(state: CopilotState, i: CopilotInput): string {
  const lines = LINES[state];
  const seed = i.lastRun?.id ?? 0;
  return lines[seed % lines.length](i);
}

export function copilotReport(i: CopilotInput): CopilotReport {
  const state = copilotState(i);
  return { state, line: copilotLine(state, i) };
}

/** Greeting line for the first view of a session (chosen client-side). */
export const greetingLine = (i: CopilotInput) => copilotLine("greeting", i);
