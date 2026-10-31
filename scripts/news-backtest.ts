/**
 * Train/test check for the news layer: does the gate help, and does Herald earn its slice?
 *
 *   npx tsx --env-file=.env.local scripts/news-backtest.ts [--months 12] [--train 8]
 *
 * Uses the live Hangar tuning for everything else (stocks only, Bastion as live). Herald settings are
 * ranked on the training window only; the test window is the verdict. Herald is compared with
 * "Herald as cash": the same slice reserved but never traded, so the units have the same room either way.
 * Needs scored headlines for the window (scripts/backfill-news.ts).
 */
import { getLiveParams } from "../lib/live-params";
import { loadSimInputs, simulate, SimParams, type SimInputs } from "../lib/simulator";

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const months = opt("months", 12);
const trainMonths = opt("train", 8);
const end = new Date();
const start = new Date(end.getTime() - months * 30.44 * 86_400_000);
const split = new Date(start.getTime() + trainMonths * 30.44 * 86_400_000);

const pct = (n: number | null | undefined) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);
const pad = (s: string, n: number) => s.padEnd(n);

type Row = { label: string; train: Stats; test: Stats };
type Stats = { ret: number; dd: number; sharpe: number | null; heraldPnl: number; heraldTrades: number; blocked: number; lifted: number };

function stats(params: SimParams, inputs: SimInputs, from: Date, to: Date): Stats {
  const r = simulate(params, inputs, { from, to });
  const h = r.byUnit.find((u) => u.strategy === "news_drift");
  return {
    ret: r.summary.totalReturn,
    dd: r.summary.maxDrawdown,
    sharpe: r.summary.sharpe,
    heraldPnl: h ? h.stats.totalPnl : 0,
    heraldTrades: h ? h.stats.count : 0,
    blocked: r.news?.buysBlocked ?? 0,
    lifted: r.news?.stopsLifted ?? 0,
  };
}

function print(title: string, rows: Row[]) {
  console.log(`\n${title}`);
  console.log(
    `${pad("setting", 34)}${pad("train ret", 11)}${pad("maxDD", 9)}${pad("Herald $", 10)}${pad("trades", 8)}| ${pad("test ret", 10)}${pad("maxDD", 9)}${pad("Sharpe", 8)}${pad("Herald $", 10)}${pad("trades", 8)}${pad("blocked", 8)}lifted`,
  );
  for (const r of rows) {
    console.log(
      `${pad(r.label, 34)}${pad(pct(r.train.ret), 11)}${pad(pct(r.train.dd), 9)}${pad(r.train.heraldPnl.toFixed(0), 10)}${pad(String(r.train.heraldTrades), 8)}| ${pad(pct(r.test.ret), 10)}${pad(pct(r.test.dd), 9)}${pad(r.test.sharpe?.toFixed(2) ?? "—", 8)}${pad(r.test.heraldPnl.toFixed(0), 10)}${pad(String(r.test.heraldTrades), 8)}${pad(String(r.test.blocked), 8)}${r.test.lifted}`,
    );
  }
}

async function main() {
  const live = await getLiveParams();
  const base = SimParams.parse({
    months: 12,
    theater: "us_equity",
    sma: live.sma,
    rsi: live.rsi,
    stopLossPct: live.stopLossPct,
    core: live.core,
    news: {
      gate: false,
      ...live.news,
      herald: { ...live.herald, enabled: false },
    },
  });
  console.log(`window ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}, train until ${split.toISOString().slice(0, 10)}`);
  // Load once with everything on: bars for Herald's list and every scored headline.
  const inputs = await loadSimInputs({ ...base, news: { ...base.news, gate: true, herald: { ...base.news.herald, enabled: true } } }, start, end);
  const scored = inputs.headlines.length;
  const firstScored = inputs.headlines.at(-1)?.createdAt.toISOString().slice(0, 10);
  console.log(`${scored.toLocaleString()} scored headline pairs in the window (earliest ${firstScored ?? "—"})`);

  const run = (label: string, p: SimParams): Row => ({ label, train: stats(p, inputs, start, split), test: stats(p, inputs, split, end) });
  const withNews = (gate: boolean, herald: Partial<SimParams["news"]["herald"]> | null): SimParams => ({
    ...base,
    news: { ...base.news, gate, herald: { ...base.news.herald, ...(herald ?? {}), enabled: herald !== null } },
  });

  // 1) Gate on/off, no Herald.
  print("NEWS GATE (live units + Bastion, stocks)", [run("no news", withNews(false, null)), run("gate on (live thresholds)", withNews(true, null))]);

  // 2) Herald grid, gate on. "As cash" reserves the slice but never fires (sentiment above the max of 1).
  const cash = run("Herald as cash (slice idle)", withNews(true, { entrySentiment: 1.01 }));
  const grid: Row[] = [];
  for (const entrySentiment of [0.5, 0.6, 0.7])
    for (const minMateriality of [0.6, 0.7, 0.8])
      for (const holdDays of [3, 5, 10])
        grid.push(run(`s≥${entrySentiment} m≥${minMateriality} hold ${holdDays}d`, withNews(true, { entrySentiment, minMateriality, holdDays })));
  grid.sort((a, b) => b.train.ret - a.train.ret);
  print("HERALD GRID (gate on), ranked by TRAIN return", [cash, ...grid]);

  const pick = grid[0];
  const beatsCash = pick.test.ret > cash.test.ret;
  const positive = pick.test.heraldPnl > 0;
  const ddOk = pick.test.dd >= cash.test.dd - 0.005;
  console.log(`\ntrain pick: ${pick.label}`);
  console.log(`  Herald P&L on test ${pick.test.heraldPnl.toFixed(0)} (${positive ? "positive" : "not positive"})`);
  console.log(`  test return ${pct(pick.test.ret)} vs Herald-as-cash ${pct(cash.test.ret)} (${beatsCash ? "beats" : "does not beat"} cash)`);
  console.log(`  test maxDD ${pct(pick.test.dd)} vs ${pct(cash.test.dd)} (${ddOk ? "no worse" : "worse"})`);
  console.log(`  ARM CRITERION: ${positive && beatsCash && ddOk ? "MET" : "NOT MET"}`);
  const rank = (r: Row) => [...grid].sort((a, b) => b.test.ret - a.test.ret).indexOf(r) + 1;
  console.log(`  train pick ranks #${rank(pick)} of ${grid.length} on test`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
