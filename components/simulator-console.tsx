"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { LiveParams } from "@/lib/live-params";
import { play } from "@/lib/sfx";

type Form = {
  months: 1 | 3 | 6 | 12;
  theater: "all" | "us_equity" | "crypto";
  fast: number;
  slow: number;
  crossLookback: number;
  period: number;
  entry: number;
  exit: number;
  stopLossPct: number;
  coreEnabled: boolean;
  corePct: number;
  newsGate: boolean;
  heraldEnabled: boolean;
  /** Live news thresholds; the console only switches the gate and Herald on or off. */
  news: LiveParams["news"] & { herald: LiveParams["herald"] };
};

const field = "num w-full border border-line-2 bg-page px-2.5 py-1.5 text-[14px] text-ink focus:border-amber";

/** Configure and launch a simulation. The secret lives in component state only. */
export function SimulatorConsole({ defaults }: { defaults: Form }) {
  const [form, setForm] = useState<Form>(defaults);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [startedAt]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  function launch() {
    setError(null);
    setElapsed(0);
    setStartedAt(Date.now());
    startTransition(async () => {
      try {
        const res = await fetch("/api/simulate", {
          method: "POST",
          headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            months: form.months,
            theater: form.theater,
            sma: { fast: form.fast, slow: form.slow, crossLookback: form.crossLookback },
            rsi: { period: form.period, entry: form.entry, exit: form.exit },
            stopLossPct: form.stopLossPct / 100,
            core: { enabled: form.coreEnabled, pct: form.corePct / 100 },
            news: {
              gate: form.newsGate,
              vetoSentiment: form.news.vetoSentiment,
              minMateriality: form.news.minMateriality,
              vetoHours: form.news.vetoHours,
              tightenPct: form.news.tightenPct,
              herald: { ...form.news.herald, enabled: form.heraldEnabled },
            },
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        play("complete");
        router.push(`/simulator?run=${body.id}`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setStartedAt(null);
      }
    });
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <label className="grid gap-1">
          <span className="hud text-[11px] text-muted">History</span>
          <select className={field} value={form.months} onChange={(e) => set("months", Number(e.target.value) as Form["months"])}>
            <option value={1}>1 month</option>
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="hud text-[11px] text-muted">Theater</span>
          <select className={field} value={form.theater} onChange={(e) => set("theater", e.target.value as Form["theater"])}>
            <option value="all">All</option>
            <option value="us_equity">Equities</option>
            <option value="crypto">Crypto</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="hud text-[11px] text-muted">Protective stop %</span>
          <input className={field} type="number" step="0.5" min="0.5" max="50" value={form.stopLossPct} onChange={num("stopLossPct")} />
        </label>
      </div>

      <fieldset className="grid grid-cols-2 gap-3 border border-cyan/40 p-3 md:grid-cols-4">
        <legend className="hud px-1 text-[12px] text-cyan">Unit-00 Bastion · SPY core</legend>
        <label className="flex items-center gap-2 self-end pb-2">
          <input type="checkbox" className="accent-cyan" checked={form.coreEnabled} onChange={(e) => set("coreEnabled", e.target.checked)} />
          <span className="hud text-[12px] text-ink-2">Armed</span>
        </label>
        <label className="grid gap-1">
          <span className="hud text-[11px] text-muted">Core share %</span>
          <input className={field} type="number" min="10" max="90" step="5" value={form.corePct} onChange={num("corePct")} disabled={!form.coreEnabled} />
        </label>
        <p className="col-span-2 self-end pb-1 text-[12px] text-muted">
          Holds SPY while it closes above its 200-day average. Units trade in the rest, and no unit buys while SPY is below.
        </p>
      </fieldset>

      <fieldset className="flex flex-wrap items-center gap-x-8 gap-y-2 border border-amber/40 p-3">
        <legend className="hud px-1 text-[12px] text-amber">News · replayed from scored headlines</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-alert" checked={form.newsGate} onChange={(e) => set("newsGate", e.target.checked)} />
          <span className="hud text-[12px] text-ink-2">News gate</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-amber" checked={form.heraldEnabled} onChange={(e) => set("heraldEnabled", e.target.checked)} />
          <span className="hud text-[12px] text-ink-2">Unit-03 Herald ({Math.round(form.news.herald.pct * 100)}% slice)</span>
        </label>
        <p className="text-[12px] text-muted">Uses the Hangar&apos;s news thresholds. Equities only; history starts where the headline backfill does.</p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset className="grid grid-cols-3 gap-3 border border-unit/40 p-3">
          <legend className="hud px-1 text-[12px] text-unit">Unit-01 Vanguard · SMA cross</legend>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Fast</span>
            <input className={field} type="number" min="2" value={form.fast} onChange={num("fast")} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Slow</span>
            <input className={field} type="number" min="3" value={form.slow} onChange={num("slow")} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Cross within</span>
            <input className={field} type="number" min="1" value={form.crossLookback} onChange={num("crossLookback")} />
          </label>
        </fieldset>
        <fieldset className="grid grid-cols-3 gap-3 border border-alert/40 p-3">
          <legend className="hud px-1 text-[12px] text-alert">Unit-02 Recoil · RSI revert</legend>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Period</span>
            <input className={field} type="number" min="2" value={form.period} onChange={num("period")} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Buy below</span>
            <input className={field} type="number" min="1" max="99" value={form.entry} onChange={num("entry")} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Sell above</span>
            <input className={field} type="number" min="1" max="99" value={form.exit} onChange={num("exit")} />
          </label>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="hud text-[11px] text-muted">ADMIN_SECRET (running costs API calls)</span>
          <input
            className={`${field} w-72`}
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="required to launch"
          />
        </label>
        <button
          onClick={launch}
          disabled={!secret || pending}
          className="hud slant bg-amber px-6 py-2 text-[15px] text-[#0b0a10] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <span className="unslant inline-block">{pending ? `Simulating… ${elapsed}s` : "Launch simulation"}</span>
        </button>
        <button
          onClick={() => setForm(defaults)}
          disabled={pending}
          className="hud border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:border-amber hover:text-amber disabled:opacity-40"
        >
          Reset to live settings
        </button>
      </div>
      {pending && (
        <p className="text-[13px] text-muted">
          Fetching real 15-minute bars from Alpaca and replaying them bar by bar. 12 months takes up to a minute.
        </p>
      )}
      {error && <p className="text-[13px] text-alert">Simulation failed: {error}</p>}
    </div>
  );
}
