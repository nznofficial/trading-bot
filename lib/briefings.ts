import { CRYPTO_RISK, PORTFOLIO_RISK, RISK } from "./config";
import { DAMAGE } from "./copilot";
import { duration, pct, qty, signedPct, signedUsd, usd } from "./format";
import { unitFor, type UnitId } from "./units";

/**
 * JC-316's component briefings: click a panel (or a row inside one) and the copilot explains it.
 * Pages attach `data-brief` (an id below) and `data-brief-ctx` (values already formatted the way the
 * panel shows them) via `briefAttrs`. Templates only arrange those values and fixed rules from
 * config; they never compute new numbers, so a briefing can't disagree with the screen.
 */

export type BriefCtx = Record<string, string | number | boolean | null | undefined>;
/** Who delivers a briefing: JC-316, or the wingman unit the component belongs to. */
export type Speaker = "jc316" | VoicedUnit;
/** Units with art and a recorded voice. Herald (UNIT-03) is briefed by JC-316 until it has both. */
export type VoicedUnit = Exclude<UnitId, "news_drift">;
export type Briefing = {
  title: string;
  what: string;
  now: string;
  note: string;
  speaker: Speaker;
  /** A line in the speaker's own voice (wingmen only). */
  quote: string | null;
};

type Text = string | ((c: BriefCtx) => string);
type Def = { title: Text; what: Text; now: Text; note: Text };

/** Context value as display text ("—" when missing). */
const v = (c: BriefCtx, k: string) => {
  const x = c[k];
  return x === null || x === undefined || x === "" ? "—" : String(x);
};
const n = (c: BriefCtx, k: string) => (typeof c[k] === "number" ? (c[k] as number) : null);
/** "Vanguard: " prefix when a metric is scoped to one unit/run/theater. */
const scope = (c: BriefCtx) => (c.scope ? `${c.scope}: ` : "");
/** Generic "scope: value · sub." reading for single-number metrics. */
const reading = (c: BriefCtx) => {
  const value = v(c, "value") === "—" ? (c.scope ? "no reading yet" : "No reading yet") : v(c, "value");
  return `${scope(c)}${value}${c.sub ? ` · ${c.sub}` : ""}.`;
};
const callsign = (c: BriefCtx) => unitFor((c.unit as string) ?? null)?.callsign ?? "Manual";

const EXIT_RULE: Record<string, string> = {
  sma_cross: "Exit: when the fast moving average drops back below the slow one, or the protective stop is hit.",
  rsi_revert: "Exit: when RSI climbs back above its sell level, or the protective stop is hit.",
};
const ENTRY_RULE: Record<string, string> = {
  sma_cross: "Vanguard enters on a fresh crossover, the fast moving average rising through the slow one, and rides the trend.",
  rsi_revert: "Recoil buys oversold dips, RSI below its buy level, and sells into the recovery.",
};

const thin = (c: BriefCtx, k = "count") => {
  const count = n(c, k);
  return count !== null && count < 20
    ? `Only ${count} closed trade${count === 1 ? "" : "s"} so far: too few to judge. Give it a few dozen before drawing conclusions.`
    : null;
};

export const BRIEFS = {
  // ── Pages ───────────────────────────────────────────────────────────────────────────────────
  "page-bridge": {
    title: "Bridge",
    what: "Command overview: account value, health gauges, risk metrics, performance against the market, and the latest engagements.",
    now: "All systems on one deck. Every panel here can be briefed.",
    note: "Start with frame value and armor integrity; they tell you how the account is doing and how much it's been hurt.",
  },
  "page-engagements": {
    title: "Engagements",
    what: "Every position the bot holds right now, from the latest sortie's snapshot.",
    now: "Click any position for its entry logic and exit rule.",
    note: "Use the theater tabs to split equities from crypto.",
  },
  "page-combat-log": {
    title: "Combat Log",
    what: "Closed trades, matched first-in first-out, and every order sent to the broker.",
    now: "Stats on top, then damage by target, closed engagements and orders fired.",
    note: "Each closed engagement has a Debrief with the price path and the signals behind it.",
  },
  "page-hangar": {
    title: "Hangar",
    what: "The strategy units: their rules, combat record, live tuning, and the targeting computer's latest calls.",
    now: "Three units: Bastion holds the SPY core; Vanguard (trend) and Recoil (dip-buying) trade around it.",
    note: "Retune here, but simulate first. Changes go live on the next sortie.",
  },
  "page-sorties": {
    title: "Sorties",
    what: "The log of every 15-minute cycle the bot has run, plus the command override.",
    now: "cron-job.org launches a sortie every 15 minutes; GitHub Actions is the backup.",
    note: "A red Abort row means a cycle failed. Click it to see why.",
  },
  "page-simulator": {
    title: "Simulator",
    what: "Replays the units over real historical bars so you can test settings before trusting them with the account.",
    now: "Set parameters, launch, then compare runs.",
    note: "Judge a setting on history it wasn't tuned on. A setting that only shines on one window is curve-fit.",
  },
  "page-debrief": {
    title: "Mission debrief",
    what: "One closed engagement, start to finish: entry, exit, the price path, and every call the unit made on that target.",
    now: "Click the flight path or a call for details.",
    note: "Losses are part of the plan. The question is whether the rules were followed.",
  },

  "page-intel": {
    title: "Intel",
    what: "The news wire: every headline Alpaca's feed carries for the bot's targets, scored by Claude for each target it names.",
    now: "Wire on the left; blocks, Herald's trades and the gate log on the right.",
    note: "Sentiment says which way a headline points; materiality says whether it's news at all. The gate only acts when both are strong.",
  },
  "intel-headlines": {
    title: "Headlines, last 24 hours",
    what: "Articles pulled from Alpaca's news feed (Benzinga and partners) that tag at least one symbol the bot tracks.",
    now: (c) => `${v(c, "count")} in the last day${c.newest ? `; the newest is from ${v(c, "newest")}` : ""}.`,
    note: "Each sortie pulls what's new. Weekends and nights run thin.",
  },
  "intel-scored": {
    title: "Scored pairs",
    what: "One score per headline per target it names: sentiment from −1 to +1 for that stock, and materiality from 0 (noise) to 1 (moves the price).",
    now: (c) => `${v(c, "count")} headline × target pairs scored in the last day.`,
    note: "Roundups that tag many tickers only get their first few targets scored.",
  },
  "intel-gate": {
    title: "News gate",
    what: "The defensive layer. A headline at or below the veto sentiment, with enough materiality, blocks new buys in that target and lifts the stop on any open position. Bastion's SPY is exempt.",
    now: (c) =>
      `${v(c, "status")}. Veto at sentiment ${v(c, "sentiment")} or worse with materiality ${v(c, "materiality")}+, for ${v(c, "hours")} hours; stops lift to ${v(c, "tighten")} under the price. ${v(c, "blocks")} active.`,
    note: "It never sells on a headline by itself. The tighter stop does that only if the price follows through.",
  },
  "intel-herald": {
    title: "UNIT-03 Herald",
    what: "The news unit. It buys a large cap after a strongly positive, material headline and holds it for a few trading days to ride the post-news drift, in its own slice of equity.",
    now: (c) =>
      `${v(c, "status")}. Buys at sentiment ${v(c, "sentiment")}+ with materiality ${v(c, "materiality")}+, holds ${v(c, "days")} trading days, ${v(c, "share")} of equity.`,
    note: "Herald stays safed until a backtest on headlines it wasn't tuned on shows it beats holding cash.",
  },
  "intel-wire": {
    title: "Incoming wire",
    what: "Every headline for a tracked target, newest first, with a score chip for each target it names.",
    now: (c) => `${v(c, "count")} headlines in this view (${v(c, "view")}).`,
    note: "Switch to Material to hide the noise. Click a chip for Claude's one-line reasoning.",
  },
  "intel-headline": {
    title: "Headline",
    what: (c) => `${v(c, "headline")} (${v(c, "source")}, ${v(c, "time")}).`,
    now: (c) => (c.targets ? `Scored for ${v(c, "targets")}. ${c.rationale ? v(c, "rationale") : ""}`.trim() : "Not scored yet. It's queued for the next sortie."),
    note: (c) => (n(c, "actions") ? "This headline triggered a gate action; see the arrow under it." : "No action taken on this one."),
  },
  "intel-score": {
    title: (c) => `Score · ${v(c, "symbol")}`,
    what: (c) => `How "${v(c, "headline")}" reads for ${v(c, "symbol")}.`,
    now: (c) => `Sentiment ${v(c, "sentiment")}, materiality ${v(c, "materiality")}, ${v(c, "category")}. ${v(c, "rationale")}`,
    note: (c) => (c.material ? "Material: strong enough for the gate or Herald to act if the sentiment is too." : "Below the material line: noise as far as trading goes."),
  },
  "intel-blocks": {
    title: "Active blocks",
    what: "Targets with a live news veto: no unit may open a new position in them until it expires.",
    now: (c) => (n(c, "count") ? `${v(c, "count")} blocked right now.` : "Nothing blocked."),
    note: (c) => `Each block lasts ${v(c, "hours")} hours from the headline. Exits and stops still run normally.`,
  },
  "intel-block": {
    title: (c) => `Blocked · ${v(c, "symbol")}`,
    what: (c) => `${v(c, "unitCode")} can't buy ${v(c, "symbol")} after a strongly negative, material headline.`,
    now: (c) => `"${v(c, "headline")}" scored ${v(c, "sentiment")}. Blocked until ${v(c, "until")}.`,
    note: (c) => `If the bot holds ${v(c, "symbol")}, its stop was lifted to ${v(c, "tighten")} under the price.`,
  },
  "intel-herald-sorties": {
    title: "Herald's trades",
    what: "Open news-drift positions, each held a fixed number of trading days after the headline that triggered it.",
    now: (c) => (c.status === "Armed" ? `${v(c, "count")} open; each held ${v(c, "days")} trading days.` : "Safed: no news trades."),
    note: "Herald's P&L is judged on its own slice, separate from Vanguard and Recoil.",
  },
  "intel-log": {
    title: "Gate log",
    what: "The audit trail: every veto, lifted stop and skipped buy, with the headline that caused it.",
    now: (c) => `${v(c, "count")} recent entries.`,
    note: "Every news action is automatic, and every one lands here and in the Discord alerts.",
  },
  // ── Account metrics (Bridge) ────────────────────────────────────────────────────────────────
  equity: {
    title: "Frame value",
    what: "Total account equity: cash plus the market value of every open position, from the latest snapshot. Today compares with yesterday's close; since launch compares with the first snapshot.",
    now: (c) => `Frame value ${v(c, "equity")}. Today ${v(c, "day")} (${v(c, "dayPct")}). Since launch ${v(c, "total")} (${v(c, "totalPct")}).`,
    note: (c) => {
      const d = n(c, "dayRaw") ?? 0;
      if (d <= PORTFOLIO_RISK.dailyLossHaltPct)
        return `Daily-loss halt engaged: at ${pct(PORTFOLIO_RISK.dailyLossHaltPct, 0)} or worse no new entries fire. Exits and stops still work.`;
      if (d <= DAMAGE.dayPct)
        return `Down more than ${pct(-DAMAGE.dayPct, 0)} today. If it reaches ${pct(PORTFOLIO_RISK.dailyLossHaltPct, 0)}, new entries halt.`;
      return "The curve is thinned for drawing: full detail for 7 days, hourly to 90 days, daily after that. Every metric uses every snapshot.";
    },
  },
  "frame-status": {
    title: "Frame status",
    what: "The account's vital signs: armor (drawdown), sync rate (win rate), power output (capital deployed), combo, and cash and P&L readouts.",
    now: (c) => `Last sortie ${v(c, "lastRun")}, status ${v(c, "status")}.`,
    note: (c) =>
      c.paused
        ? "Units are on hold. Sorties still sync and snapshot, but nothing is evaluated. Resume from Sorties."
        : "Click any gauge or readout for its own briefing.",
  },
  armor: {
    title: "Armor integrity",
    what: "100% at the all-time equity peak; it drops by however far equity sits below that peak right now (current drawdown).",
    now: (c) => `Armor ${v(c, "value")}, ${v(c, "drawdown")} from peak.`,
    note: `Green at 97% or more, amber from 90%, red below. At ${pct(-DAMAGE.drawdown, 0)} off peak I switch to my damaged state.`,
  },
  "win-rate": {
    title: "Win rate",
    what: "Share of closed trades that made money. A trade that breaks even counts as a loss.",
    now: reading,
    note: (c) =>
      thin(c) ??
      "Read it next to profit factor. Dip-buying tends to win often in small amounts; trend-riding wins less often but can win bigger.",
  },
  exposure: {
    title: "Power output",
    what: "Market value of open positions divided by total equity: how much of the account is in the market right now.",
    now: (c) => `${v(c, "value")} deployed across ${v(c, "open")} engagement${c.open === 1 ? "" : "s"}.`,
    note: `Limits: ${PORTFOLIO_RISK.maxOpenPositions} positions at most, ${pct(RISK.maxPositionPct, 0)} of equity per stock, ${pct(CRYPTO_RISK.maxPositionPct, 0)} per coin, crypto capped at ${pct(CRYPTO_RISK.maxClassPct, 0)} overall.`,
  },
  streak: {
    title: "Combo",
    what: "Consecutive winning trades, counted back from the most recent exit. One loss resets it to zero.",
    now: (c) => `Combo at ${v(c, "value")}.`,
    note: "A streak is luck as much as skill. The rules don't change because of it, and neither should you.",
  },
  cash: {
    title: "Cash reserves",
    what: "Uninvested cash in the paper account. Stocks can draw on margin buying power; crypto can only be bought with cash.",
    now: (c) => `${v(c, "value")} in reserve.`,
    note: `The risk gate keeps a ${pct(1 - PORTFOLIO_RISK.buyingPowerBuffer, 0)} buying-power buffer so orders aren't rejected on price drift.`,
  },
  realized: {
    title: "Realized P&L",
    what: "Profit or loss locked in by closed trades, after modeled crypto fees.",
    now: reading,
    note: "This only changes when a position closes. Open positions show up in unrealized.",
  },
  unrealized: {
    title: "Unrealized P&L",
    what: "Paper profit or loss on positions still open, at the latest snapshot price.",
    now: reading,
    note: "It isn't banked until the position closes, and the protective stop limits how far it can fall.",
  },
  "last-sortie": {
    title: "Last sortie",
    what: "When the bot last ran its cycle: sync fills, snapshot the account, evaluate every target, place orders.",
    now: (c) => `${v(c, "value")}, status ${v(c, "status")}.`,
    note: "Sorties fire every 15 minutes, around the clock. Equities are only evaluated in the regular session.",
  },
  "max-drawdown": {
    title: "Max damage",
    what: "The largest fall from an equity peak to a later low, ever recorded.",
    now: reading,
    note: "This is the pain you'd have had to sit through. Weigh it against the return: a small gain bought with a deep drawdown is a bad trade-off.",
  },
  sharpe: {
    title: "Sharpe ratio",
    what: "Average daily return divided by its volatility, annualized over 365 days (crypto trades on weekends). The risk-free rate is taken as zero.",
    now: reading,
    note: (c) => {
      const days = n(c, "days");
      return days !== null && days < 60
        ? `Only ${days} day${days === 1 ? "" : "s"} of history: Sharpe swings wildly this early. Over 1 is good and over 2 excellent, once months of data back it.`
        : "Over 1 is good, over 2 excellent. It treats upside and downside swings alike; compare with Sortino.";
    },
  },
  sortino: {
    title: "Sortino ratio",
    what: "Like Sharpe, but only losing days count as risk, so upside volatility isn't penalized.",
    now: reading,
    note: "Sortino well above Sharpe means most of the volatility is on the upside, which is the good kind.",
  },
  "profit-factor": {
    title: "Profit factor",
    what: "Gross winnings divided by gross losses. Above 1.0 the wins paid for the losses; ∞ means no losing trade yet.",
    now: reading,
    note: (c) => thin(c) ?? "Below 1.0 the unit is losing money overall. Around 1.5 or better is a healthy rule of thumb for rule-based strategies.",
  },
  expectancy: {
    title: "Expectancy",
    what: "Average net P&L per closed trade: total profit minus total loss, divided by the number of trades.",
    now: reading,
    note: (c) => thin(c) ?? "What one more trade is worth on average, if the past holds. Crypto fees are already subtracted.",
  },
  "closed-count": {
    title: "Closed trades",
    what: "Completed round trips. Each sell is matched first-in, first-out with the oldest open buy of that symbol.",
    now: reading,
    note: (c) => thin(c, "value") ?? "Enough trades to start trusting the stats. Keep watching them by unit in the Hangar.",
  },
  "avg-hold": {
    title: "Average hold",
    what: "Average time from entry to exit across closed trades.",
    now: reading,
    note: "Trend trades tend to run longer; dip-buys usually resolve faster, one way or the other.",
  },
  fees: {
    title: "Fees",
    what: `Crypto trading fees, about 0.25% on each side (taken in coin on buys, in dollars on sells). Stocks trade commission-free.`,
    now: reading,
    note: "Fees were the reason crypto entries were switched off: backtests found the units' edge on crypto didn't survive them.",
  },
  deployed: {
    title: "Open positions",
    what: "How many positions this unit holds right now.",
    now: reading,
    note: `Across all units the bot holds at most ${PORTFOLIO_RISK.maxOpenPositions} positions at once.`,
  },
  "final-equity": {
    title: "Final equity",
    what: "Simulated account value at the end of the replay, starting from the same equity as the live account.",
    now: reading,
    note: "Compare the return against SPY and BTC buy-and-hold in the debrief above.",
  },

  // ── Bridge panels ───────────────────────────────────────────────────────────────────────────
  versus: {
    title: "Versus",
    what: "Cumulative return since launch, by daily close, against simply buying and holding SPY or BTC over the same days.",
    now: (c) => `You ${v(c, "you")}, SPY ${v(c, "spy")}, BTC ${v(c, "btc")}.`,
    note: (c) => {
      const you = n(c, "youRaw");
      const spy = n(c, "spyRaw");
      if (you === null || spy === null) return "This opens after two days of history.";
      return you >= spy
        ? "Ahead of an S&P 500 index fund so far. Keep it there over months, not days."
        : "Behind an S&P 500 index fund so far. That's the bar every strategy has to clear to be worth running.";
    },
  },
  "drawdown-chart": {
    title: "Damage report",
    what: "How far equity sat below its running peak at every snapshot. 0% means a new high.",
    now: (c) => `Worst hit ${v(c, "max")}; now ${v(c, "current")}.`,
    note: "Shallow, short dips are normal. Long stretches underwater are what to watch.",
  },
  theaters: {
    title: "Theaters",
    what: "Results split by asset class: equities (10 symbols, market hours) and crypto (BTC, ETH, SOL, around the clock).",
    now: "Click a theater row for its rules.",
    note: "Deployed is each theater's open position value as a share of total equity.",
  },
  theater: {
    title: (c) => `${v(c, "label")} theater`,
    what: (c) =>
      c.cls === "crypto"
        ? `BTC, ETH and SOL, around the clock. Up to ${pct(CRYPTO_RISK.maxPositionPct, 0)} of equity per coin and ${pct(CRYPTO_RISK.maxClassPct, 0)} in total; the bot keeps a stop-limit order resting under each position.`
        : `Ten liquid US stocks and ETFs, regular session only. Up to ${pct(RISK.maxPositionPct, 0)} of equity per position, each entry sent with a protective stop attached.`,
    now: (c) =>
      `${v(c, "deployed")} deployed, ${v(c, "open")} open. Realized ${v(c, "realized")}, unrealized ${v(c, "unrealized")}. Won ${v(c, "won")}.`,
    note: (c) =>
      c.cls === "crypto"
        ? `Fees run about 0.25% each side (${v(c, "fees")} paid so far). New crypto entries are currently controlled from Hangar → Tune units.`
        : "No commissions on equities. Every entry carries its protective stop from the moment it fills.",
  },
  "active-engagements": {
    title: "Active engagements",
    what: "Positions the bot holds right now, from the latest snapshot.",
    now: (c) => `${v(c, "count")} open.`,
    note: "Click a position for its entry logic and exit rule.",
  },
  "recent-trades": {
    title: "Combat log",
    what: "The five most recent closed trades.",
    now: (c) => `${v(c, "count")} shown. Full history in the Combat Log.`,
    note: "Click a row for that engagement's briefing, or Debrief ▸ for the full replay.",
  },
  "ko-banner": {
    title: "Target neutralized",
    what: "Shown when a trade closed in the last 24 hours returned 2% or more.",
    now: (c) => `${v(c, "symbol")} closed at ${v(c, "pnl")} (${v(c, "ret")}).`,
    note: "Big wins pay for many small losses. That's the arithmetic the units are built on.",
  },
  "damage-banner": {
    title: "Taking damage",
    what: `Shown when the day's P&L is at or below ${pct(DAMAGE.dayPct, 0)}.`,
    now: (c) => `Day at ${v(c, "pnl")} (${v(c, "pct")}).`,
    note: `Stops are armed on every position. At ${pct(PORTFOLIO_RISK.dailyLossHaltPct, 0)} the daily-loss halt blocks new entries while the day stays that low.`,
  },

  // ── Positions and trades ────────────────────────────────────────────────────────────────────
  positions: {
    title: "Open positions",
    what: "Every position held at the latest snapshot, with average entry, last price and paper P&L.",
    now: (c) => `${v(c, "count")} open, worth ${v(c, "value")}. Unrealized ${v(c, "upl")}.`,
    note: "Click a position for its exit rule.",
  },
  position: {
    title: (c) => `Engagement · ${v(c, "symbol")}`,
    what: (c) => ENTRY_RULE[c.unit as string] ?? "Opened manually, outside the strategy units.",
    now: (c) =>
      `${unitFor((c.unit as string) ?? null) ? `${callsign(c)} holds` : "Held manually:"} ${v(c, "qty")} ${v(c, "symbol")}${c.avgEntry ? ` from ${c.avgEntry}` : ""}, now ${v(c, "price")}, worth ${v(c, "value")}. Unrealized ${v(c, "upl")} (${v(c, "uplPct")}).`,
    note: (c) => EXIT_RULE[c.unit as string] ?? "No unit manages this position's signals.",
  },
  trade: {
    title: (c) => `Closed · ${v(c, "symbol")}`,
    what: "A completed round trip: a buy matched first-in, first-out with the sell that closed it. P&L is after modeled fees.",
    now: (c) =>
      `${unitFor((c.unit as string) ?? null) ? `${callsign(c)} took` : "Manual trade:"} ${v(c, "symbol")} from ${v(c, "entry")} to ${v(c, "exit")}: ${v(c, "pnl")}${c.ret ? ` (${c.ret})` : ""}, held ${v(c, "held")}.`,
    note: (c) =>
      (n(c, "pnlRaw") ?? 0) > 0
        ? "Clean hit. Open Debrief ▸ to see what triggered the entry and the exit."
        : "A loss. Open Debrief ▸ to check whether the stop or the unit's exit rule closed it.",
  },
  "closed-trades": {
    title: "Closed engagements",
    what: "Every completed round trip, newest first, matched first-in first-out.",
    now: (c) => `${v(c, "count")} closed.`,
    note: "Click a row for a quick read, or Debrief ▸ for the full replay.",
  },
  "by-target": {
    title: "Damage dealt by target",
    what: "Net P&L per symbol across closed trades, after fees.",
    now: (c) => `${scope(c)}${v(c, "count")} symbol${c.count === 1 ? "" : "s"} traded.`,
    note: "Symbols that keep bleeding show where a unit's rules fit that market poorly.",
  },
  orders: {
    title: "Orders fired",
    what: "Every order sent to the broker, including protective stop legs (marked ↳).",
    now: (c) => `${v(c, "count")} shown, latest first.`,
    note: "Click an order for what its status means.",
  },
  order: {
    title: (c) => `Order · ${v(c, "symbol")}`,
    what: (c) =>
      c.leg
        ? "A protective stop leg, sent together with its entry order. It sells automatically if the price falls to the stop."
        : c.kind === "stop_limit"
          ? "A bot-managed stop-limit for a crypto position (the broker doesn't attach stops to crypto entries)."
          : c.side === "buy"
            ? "An entry order: a unit buying in."
            : "An exit order: a unit selling out.",
    now: (c) =>
      `${v(c, "side")} ${v(c, "qty")} ${v(c, "symbol")}, ${v(c, "type")}, status ${v(c, "status").replaceAll("_", " ")}${c.fill ? `, filled at ${c.fill}` : ""}.`,
    note: (c) =>
      ({
        filled: "Executed. The fill price is what the account actually paid or received.",
        held: "Waiting behind its parent order; it arms once the entry fills.",
        new: "Resting at the broker, armed but not triggered.",
        accepted: "Resting at the broker, armed but not triggered.",
        canceled: "Canceled. Usually a stop leg cleared because the unit exited first.",
        expired: "Expired unfilled.",
        rejected: "The broker rejected it. Check Sorties for the error.",
      })[c.status as string] ?? "Status as last synced from the broker.",
  },

  // ── Debrief ─────────────────────────────────────────────────────────────────────────────────
  "debrief-hero": {
    title: (c) => `Debrief · ${v(c, "symbol")}`,
    what: (c) => ENTRY_RULE[c.unit as string] ?? "A manual trade, placed outside the strategy units.",
    now: (c) => `${callsign(c)}: ${v(c, "pnl")} (${v(c, "ret")}). Exit by ${v(c, "exitBy")}.`,
    note: (c) => EXIT_RULE[c.unit as string] ?? "No unit rules applied to this trade.",
  },
  "exit-by": {
    title: "Exit by",
    what: "What closed the trade: the protective stop, the unit's own exit signal, or a manual order.",
    now: (c) => `${v(c, "value")}.`,
    note: (c) =>
      c.kind === "stop"
        ? `A stop-out starts a ${PORTFOLIO_RISK.reentryCooldownHours}-hour cooldown on this symbol, so the unit can't whipsaw straight back in.`
        : c.kind === "signal"
          ? "The unit's rules called the exit. This is the strategy working as designed, win or lose."
          : "Closed outside the units' rules.",
  },
  "flight-path": {
    title: "Flight path",
    what: "15-minute closes around the engagement, with the entry, exit and protective stop marked.",
    now: (c) => `Entry ${v(c, "entry")}, exit ${v(c, "exit")}, stop ${v(c, "stop")}.`,
    note: "Hover the chart for prices bar by bar.",
  },
  "why-fired": {
    title: "Why it fired",
    what: "Every buy and sell call the unit made on this target during the engagement, with the indicator readings behind it.",
    now: (c) => `${v(c, "count")} call${c.count === 1 ? "" : "s"} recorded.`,
    note: "Hold calls aren't stored here, only buys and sells.",
  },
  "flight-data": {
    title: "Flight data",
    what: "Broker order references and the stop that protected the position.",
    now: (c) => `Protective stop ${v(c, "stop")}, fees ${v(c, "fees")}.`,
    note: "The order IDs match the broker's records if you need to audit a fill.",
  },

  // ── Hangar ──────────────────────────────────────────────────────────────────────────────────
  unit: {
    title: (c) => `${v(c, "code")} ${callsign(c)}`,
    what: (c) => `${v(c, "role")}. ${v(c, "description")}`,
    now: (c) =>
      `${c.count ? `${v(c, "count")} closed trades, win rate ${v(c, "winRate")}, realized ${v(c, "realized")}` : "No closed trades yet"}, ${v(c, "open")} open. Targets: ${v(c, "symbols")}.`,
    note: (c) =>
      c.unit === "sma_cross"
        ? "Trend-followers lose small and often in choppy, sideways markets, then earn their keep in sustained moves. Patience is the strategy."
        : "Mean reversion wins often in calm markets. The danger is a dip that keeps dipping, and that's what the stop is for.",
  },
  "unit-sorties": {
    title: "Sorties flown",
    what: "Closed trades for this unit. The bar fills at 50, roughly where its stats start to carry weight.",
    now: reading,
    note: (c) => thin(c, "value") ?? "Enough history to compare it fairly with the other unit.",
  },
  tune: {
    title: "Tune units",
    what: "Live settings for both units and the protective stop. Changes apply from the next sortie and are logged in Sorties as Retuned.",
    now: (c) => `Stop ${v(c, "stop")}. Equity entries ${v(c, "stocks")}, crypto entries ${v(c, "crypto")}.`,
    note: (c) =>
      c.crypto === "safed"
        ? "Crypto entries are safed: backtests found no edge after fees. Open crypto positions still exit on signals and stops."
        : "Run a simulation with the new numbers before applying them.",
  },
  targeting: {
    title: "Targeting computer",
    what: "The latest evaluation of every target: what its unit decided on the most recent bar and the indicator readings behind it.",
    now: (c) => `${v(c, "count")} targets evaluated.`,
    note: "Click a row and I'll explain the readings.",
  },
  signal: {
    title: (c) => `Targeting · ${v(c, "symbol")}`,
    what: (c) =>
      c.unit === "sma_cross"
        ? "smaFast and smaSlow are moving averages of 15-minute closes. Vanguard buys when the fast one crosses above the slow one."
        : "RSI scores recent gains against losses from 0 to 100. Recoil buys when it's low (oversold) and sells once it recovers.",
    now: (c) => `${callsign(c)} on ${v(c, "symbol")}: ${String(v(c, "action")).toUpperCase()}, ${v(c, "reason")}. Telemetry ${v(c, "telemetry")}.`,
    note: (c) =>
      c.action === "hold"
        ? "Hold means no trade this bar. No signal, no shot."
        : "A buy still has to clear the risk gate (position limits, cooldown, loss halt) before an order goes out.",
  },
  calls: {
    title: "Engagement orders",
    what: "The last 100 buy and sell calls, including ones the risk gate blocked.",
    now: (c) => `${v(c, "count")} calls shown.`,
    note: "Muted outcomes were blocked. Click one to see why.",
  },
  call: {
    title: (c) => `Call · ${v(c, "symbol")}`,
    what: "A buy or sell decision from a unit's rules on one bar.",
    now: (c) => `${String(v(c, "action")).toUpperCase()}: ${v(c, "reason")}. Outcome: ${v(c, "outcome")}.`,
    note: (c) =>
      c.acted
        ? "This call became an order."
        : `Not acted on. The risk gate blocks entries for: already holding, an open order, a ${PORTFOLIO_RISK.reentryCooldownHours}h cooldown after a stop-out, ${PORTFOLIO_RISK.maxOpenPositions} positions max, the daily-loss halt, a safed theater, or no buying power.`,
  },

  // ── Sorties ─────────────────────────────────────────────────────────────────────────────────
  "sortie-record": {
    title: "Sortie record",
    what: "One row per cycle: sync fills and fees, snapshot the account, evaluate every target, place orders, manage crypto stops, send alerts.",
    now: (c) => `${v(c, "count")} sorties shown, latest ${v(c, "latest")}.`,
    note: "cron-job.org fires every 15 minutes; GitHub Actions runs as the backup. The Trigger column says which one launched each sortie.",
  },
  sortie: {
    title: (c) => `Sortie #${v(c, "id")}`,
    what: (c) =>
      ({
        ok: "A full cycle: synced, snapshotted, evaluated every target, and placed any orders.",
        closed: "Market closed and nothing to evaluate. The account was still synced and snapshotted.",
        paused: "Units on hold: it synced and snapshotted the account but evaluated nothing.",
        skipped: "Another sortie was still running, so this one stood down to avoid double orders.",
        error: "The cycle failed partway. No further orders were placed in it.",
        config: "Not a cycle: a tuning change applied from the Hangar.",
        running: "In progress, or it never reported back.",
      })[c.status as string] ?? "One bot cycle.",
    now: (c) =>
      `${v(c, "started")} via ${v(c, "trigger")}: ${v(c, "signals")} signals, ${v(c, "orders")} orders, ${v(c, "duration")}.${c.detail ? ` ${c.detail}` : ""}`,
    note: (c) =>
      ({
        "cron-job.org": "Launched by the primary scheduler.",
        github: "Launched by the GitHub Actions backup schedule.",
        admin: "Launched by hand from the command override.",
      })[c.trigger as string] ?? "Signals counts buy and sell calls; orders counts what actually went out.",
  },
  override: {
    title: "Command override",
    what: "Manual controls, all behind ADMIN_SECRET: dry run, launch now, hold, resume, a Discord test, and eject.",
    now: "Locked until the secret is entered.",
    note: "Dry run evaluates everything without placing orders. Eject closes every position and pauses the bot, so use it only in an emergency.",
  },

  // ── Simulator ───────────────────────────────────────────────────────────────────────────────
  "sim-params": {
    title: "Mission parameters",
    what: "History window, theater, unit settings and stop for a replay. Defaults are today's live settings.",
    now: "Change a value and launch to replay it over real 15-minute bars.",
    note: "Tune on one window, then check another. Settings that only work where they were tuned are curve-fit.",
  },
  "sim-debrief": {
    title: (c) => `Simulation run #${v(c, "id")}`,
    what: "A replay of real 15-minute bars with no look-ahead: orders fill at the next bar's open, stops are checked against bar lows, and crypto pays 0.25% each side.",
    now: (c) => `${v(c, "period")}: units ${v(c, "ret")}, SPY hold ${v(c, "spy")}, BTC hold ${v(c, "btc")}.`,
    note: (c) => {
      const r = n(c, "retRaw");
      const s = n(c, "spyRaw");
      if (r === null || s === null) return "Compare against buy-and-hold before trusting a setting.";
      return r >= s
        ? "Beat SPY buy-and-hold over this window. Check it on a different window before going live."
        : "Lost to SPY buy-and-hold over this window. Simply holding the index would have done better.";
    },
  },
  core: {
    title: "Bastion · core",
    what: "UNIT-00 Bastion holds SPY with a fixed share of the account while SPY's last daily close is above its 200-day average, and sells it all when SPY closes below. There's no protective stop: the average is the exit. The same line gates Vanguard and Recoil, which can't open new trades while SPY is below it.",
    now: (c) =>
      `${v(c, "status")}. SPY closed at ${v(c, "close")} against a 200-day average of ${v(c, "sma")} (${v(c, "gap")}). Core share ${v(c, "share")}; holding ${v(c, "held")}.`,
    note: "In backtests from 2021 to 2026 this rule, with the units trading in the remaining share, beat holding SPY on worst drop and risk-adjusted return, at the cost of some return in strong years. It switches rarely, about 16 times in six years.",
  },
  "unit-health": {
    title: (c) => `${callsign(c)} health`,
    what: "Live results against the newest simulation run on the same tuning: drawdown, rolling Sharpe and rolling expectancy. It tells you when to re-test a unit, not what to change.",
    now: (c) => `Overall ${v(c, "status")}. Baseline is simulation run ${v(c, "run")}.`,
    note: "One amber reading is a reason to watch. A red one means re-run the Simulator, tuning on older history and judging on the latest months, before changing anything. A losing streak alone is not a reason to retune.",
  },
  "health-drawdown": {
    title: "Health · drawdown",
    what: "How far the unit's realized P&L sits below its own peak, against the deepest drop the backtest went through on the same tuning.",
    now: (c) => `${scope(c)}${v(c, "value")} now, ${v(c, "max")} worst live, ${v(c, "baseline")} worst in the backtest. ${v(c, "status")}.`,
    note: "Amber at half the backtest's worst drop, red past it. A drawdown deeper than anything in the backtest means the market is doing something the backtest never saw.",
  },
  "health-sharpe": {
    title: "Health · rolling Sharpe",
    what: "Sharpe of the unit's daily realized P&L over the last 90 days, with days that closed nothing counted as zero, against the same measure over the backtest.",
    now: (c) => `${scope(c)}${v(c, "value")} over ${v(c, "days")} days (${v(c, "sample")} trades closed), backtest ${v(c, "baseline")}. ${v(c, "status")}.`,
    note: "Red at zero or below, amber under half the backtest's. It needs 30 days before it counts. Units can sit idle for stretches, so judge it over months, not weeks.",
  },
  "health-expectancy": {
    title: "Health · rolling expectancy",
    what: "Average return per trade over the unit's last 25 closed trades, against its average across the backtest.",
    now: (c) => `${scope(c)}${v(c, "value")} per trade over ${v(c, "sample")} trades, backtest ${v(c, "baseline")}. ${v(c, "status")}.`,
    note: "Red when the recent average turns negative, amber under half the backtest's. It needs 10 trades. This matters more than win rate: a unit can lose most trades and still pay, or win most and still lose.",
  },
  "sim-units": {
    title: "Unit performance",
    what: "Each unit's result within this simulation run.",
    now: "Click a unit for its numbers.",
    note: "A unit that only loses here is a candidate to retune or safe.",
  },
  "sim-unit": {
    title: (c) => `${callsign(c)} in simulation`,
    what: (c) => ENTRY_RULE[c.unit as string] ?? "Strategy unit.",
    now: (c) => `${v(c, "trades")} trades, win ${v(c, "win")}, net ${v(c, "pnl")}, fees ${v(c, "fees")}, avg hold ${v(c, "hold")}.`,
    note: (c) => thin({ count: n(c, "tradesRaw") }) ?? "Net P&L is after fees.",
  },
  "sim-runs": {
    title: "Compare runs",
    what: "Every simulation so far with its settings and headline results.",
    now: (c) => `${v(c, "count")} runs on file.`,
    note: "Click a run number to load its debrief. Compare runs on the same window, changing one setting at a time.",
  },
  "sim-run": {
    title: (c) => `Run #${v(c, "id")}`,
    what: (c) => `${v(c, "period")} · ${v(c, "settings")}`,
    now: (c) => `Return ${v(c, "ret")}, max drawdown ${v(c, "dd")}, Sharpe ${v(c, "sharpe")}, win ${v(c, "win")} over ${v(c, "trades")} trades, fees ${v(c, "fees")}.`,
    note: "Click the run number to load its full debrief.",
  },
  "sim-trades": {
    title: "Simulated combat log",
    what: "The latest 50 simulated trades in this run, newest first.",
    now: (c) => `${v(c, "count")} trades in the run.`,
    note: "Exit shows what closed each trade: signal, stop, or end of the replay.",
  },
  "sim-trade": {
    title: (c) => `Simulated · ${v(c, "symbol")}`,
    what: (c) => ENTRY_RULE[c.unit as string] ?? "Simulated trade.",
    now: (c) => `${v(c, "entry")} → ${v(c, "exit")}: ${v(c, "pnl")}, held ${v(c, "held")}.`,
    note: (c) =>
      ({
        stop: "Closed by the protective stop, checked against the bar's low.",
        signal: "Closed by the unit's own exit signal, filled at the next bar's open.",
        end: "Still open when the replay ended, so it was marked to the last price.",
      })[c.reason as string] ?? "Simulated exit.",
  },
} satisfies Record<string, Def>;

export type BriefId = keyof typeof BRIEFS;

export const isBriefId = (id: string): id is BriefId => Object.hasOwn(BRIEFS, id);

const resolve = (t: Text, c: BriefCtx) => (typeof t === "function" ? t(c) : t);

/**
 * Wingman voice lines. Bastion is the immovable core; Vanguard the brash trend-rider; Recoil the patient
 * counter-puncher. Like the
 * templates, they only reuse values from the context (symbol, win/loss), never new numbers.
 */
export const VOICE: Record<VoicedUnit, (id: BriefId, c: BriefCtx) => string> = {
  spy_core: (id, c) => {
    const pnl = n(c, "pnlRaw");
    if (id === "position") return "Holding the line on SPY. I move when the 200-day average says so, not before.";
    if (id === "trade" || id === "debrief-hero" || id === "sim-trade")
      return pnl !== null && pnl > 0 ? "The market carried us. I held until the line broke." : "The line broke, so I fell back. Cash is a position too.";
    if (id === "signal" || id === "call")
      return c.action === "buy"
        ? "SPY is back above its 200-day line. Advancing."
        : c.action === "sell"
          ? "SPY closed below its 200-day line. Falling back to cover."
          : "No change in the line. Holding position.";
    if (id === "order") return c.side === "buy" ? "Taking the field." : "Falling back.";
    if (id === "unit" || id === "core") return "Unit-00 Bastion. I hold the market while it's healthy, and I take cover when it isn't.";
    if (id === "sim-unit") return "I don't chase. I hold, or I wait.";
    return "Bastion. Position holding.";
  },
  sma_cross: (id, c) => {
    const sym = c.symbol ? String(c.symbol) : "the target";
    const pnl = n(c, "pnlRaw");
    if (id === "position") return `Riding the trend on ${sym}. I don't leave until the averages cross back.`;
    if (id === "trade" || id === "debrief-hero" || id === "sim-trade")
      return pnl !== null && pnl > 0
        ? `Caught the move on ${sym}. That's what trends are for.`
        : `${sym} faded on me. Trend calls lose small and often; the big runs pay for them.`;
    if (id === "signal" || id === "call")
      return c.action === "buy"
        ? `Crossover on ${sym}. Requesting clearance to engage.`
        : c.action === "sell"
          ? `Trend's broken on ${sym}. Pulling out.`
          : `Nothing worth chasing on ${sym} yet. I wait for a fresh cross.`;
    if (id === "order") return c.side === "buy" ? `Going in on ${sym}.` : `Out of ${sym}.`;
    if (id === "unit") return "Unit-01 Vanguard. I hunt trends, and I don't flinch at a few scratches.";
    if (id === "unit-health" || id.startsWith("health-"))
      return c.status === "Breach"
        ? "Something's off out there. Run me through the Simulator before you touch my settings."
        : "Systems check. Scratches are expected; I'll tell you when it's more than that.";
    if (id === "sim-unit") return "Run me through any year you like. Give me trends and I'll deliver.";
    return "Vanguard on the line. Here's my read.";
  },
  rsi_revert: (id, c) => {
    const sym = c.symbol ? String(c.symbol) : "the target";
    const pnl = n(c, "pnlRaw");
    if (id === "position") return `Bought the dip on ${sym}. Now I wait for the bounce.`;
    if (id === "trade" || id === "debrief-hero" || id === "sim-trade")
      return pnl !== null && pnl > 0
        ? `${sym} snapped back. Counter-strike landed.`
        : `${sym} kept falling. The stop did its job; I live to swing again.`;
    if (id === "signal" || id === "call")
      return c.action === "buy"
        ? `${sym} is oversold. Moving in.`
        : c.action === "sell"
          ? `${sym} recovered. Taking the bounce and stepping back.`
          : `${sym} isn't scared enough yet. Patience.`;
    if (id === "order") return c.side === "buy" ? `Catching ${sym} on the way down.` : `Selling ${sym} into the recovery.`;
    if (id === "unit") return "Unit-02 Recoil. When the market panics, I buy. When it calms down, I sell.";
    if (id === "unit-health" || id.startsWith("health-"))
      return c.status === "Breach"
        ? "These dips aren't bouncing like they used to. Test me in the Simulator before you change a thing."
        : "Counter-strike systems check. A few dips that keep falling are part of the job.";
    if (id === "sim-unit") return "Calm markets are my hunting ground. Show me the dips.";
    return "Recoil reporting. Here's the situation.";
  },
};

const speakerOf = (c: BriefCtx): Speaker => {
  const unit = (c.unit as string) ?? null;
  return unitFor(unit) && Object.hasOwn(VOICE, unit!) ? (unit as VoicedUnit) : "jc316";
};

/** Build the briefing for a component; null for unknown ids. Unit-owned components are briefed by that unit. */
export function briefing(id: string, ctx: BriefCtx = {}): Briefing | null {
  if (!isBriefId(id)) return null;
  const d: Def = BRIEFS[id];
  const speaker = speakerOf(ctx);
  return {
    title: resolve(d.title, ctx),
    what: resolve(d.what, ctx),
    now: resolve(d.now, ctx),
    note: resolve(d.note, ctx),
    speaker,
    quote: speaker === "jc316" ? null : VOICE[speaker](id, ctx),
  };
}

/** Spread onto any element to make it briefable: `<tr {...briefAttrs("trade", {...})}>`. */
export function briefAttrs(id: BriefId, ctx: BriefCtx = {}) {
  return { "data-brief": id, "data-brief-ctx": JSON.stringify(ctx) };
}

export type BriefAttrs = ReturnType<typeof briefAttrs>;

/** Briefing for an open-position row (Bridge and Engagements). */
export const positionBrief = (p: {
  symbol: string;
  strategy: string | null;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlpc: number;
}) =>
  briefAttrs("position", {
    symbol: p.symbol,
    unit: p.strategy,
    qty: qty(p.qty),
    avgEntry: usd(p.avgEntry),
    price: usd(p.currentPrice),
    value: usd(p.marketValue),
    upl: signedUsd(p.unrealizedPl),
    uplPct: signedPct(p.unrealizedPlpc),
  });

/** Briefing for a closed-trade row (Bridge and Combat Log). */
export const tradeBrief = (t: {
  symbol: string;
  strategy: string | null;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  returnPct: number;
  holdMs: number;
}) =>
  briefAttrs("trade", {
    symbol: t.symbol,
    unit: t.strategy,
    entry: usd(t.entryPrice),
    exit: usd(t.exitPrice),
    pnl: signedUsd(t.pnl),
    pnlRaw: t.pnl,
    ret: signedPct(t.returnPct),
    held: duration(t.holdMs),
  });
