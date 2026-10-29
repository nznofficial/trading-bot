"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { play } from "@/lib/sfx";
import type { LiveParams } from "@/lib/live-params";

const field = "num w-full border border-line-2 bg-page px-2.5 py-1.5 text-[14px] text-ink focus:border-amber";

/** Edit live unit tuning. Applies from the next sortie; every change is logged in Sorties. */
export function TuneConsole({ current }: { current: LiveParams }) {
  const [p, setP] = useState(current);
  const [secret, setSecret] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const n = (path: (v: number) => LiveParams) => (e: React.ChangeEvent<HTMLInputElement>) => setP(path(Number(e.target.value)));

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tune", params: p }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: body.error ?? `HTTP ${res.status}` });
        return;
      }
      play("complete");
      const changes: string[] = body.result?.changes ?? [];
      setMsg({ ok: true, text: changes.length ? `Saved: ${changes.join(" · ")}` : "No changes." });
      router.refresh();
    });
  }

  const toggle = (key: "stocksEnabled" | "cryptoEnabled", label: string) => (
    <label className="flex cursor-pointer items-center gap-2.5">
      <input type="checkbox" checked={p[key]} onChange={(e) => setP({ ...p, [key]: e.target.checked })} className="size-4 accent-[var(--sync)]" />
      <span className="hud text-[13px] text-ink-2">{label}</span>
      <span className={`hud text-[11px] ${p[key] ? "text-sync" : "text-alert"}`}>{p[key] ? "armed" : "safed"}</span>
    </label>
  );

  return (
    <div className="grid grid-cols-1 gap-5">
      <fieldset className="flex flex-wrap items-end gap-x-8 gap-y-3 border border-cyan/40 p-3">
        <legend className="hud px-1 text-[12px] text-cyan">Unit-00 Bastion · SPY core</legend>
        <label className="flex cursor-pointer items-center gap-2.5 pb-1.5">
          <input
            type="checkbox"
            checked={p.core.enabled}
            onChange={(e) => setP({ ...p, core: { ...p.core, enabled: e.target.checked } })}
            className="size-4 accent-[var(--cyan)]"
          />
          <span className="hud text-[13px] text-ink-2">Core</span>
          <span className={`hud text-[11px] ${p.core.enabled ? "text-sync" : "text-alert"}`}>{p.core.enabled ? "armed" : "safed"}</span>
        </label>
        <label className="grid w-40 gap-1">
          <span className="hud text-[11px] text-muted">Core share %</span>
          <input
            className={field}
            type="number"
            step="5"
            min="10"
            max="90"
            value={Math.round(p.core.pct * 100)}
            onChange={n((v) => ({ ...p, core: { ...p.core, pct: v / 100 } }))}
          />
        </label>
        <p className="max-w-md pb-1 text-[12px] text-muted">
          Holds SPY while it closes above its 200-day average. Vanguard and Recoil share the remaining{" "}
          {p.core.enabled ? Math.round((1 - p.core.pct) * 100) : 100}%, and neither opens trades while SPY is below the line.
        </p>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <fieldset className="grid grid-cols-3 gap-3 border border-unit/40 p-3">
          <legend className="hud px-1 text-[12px] text-unit">Unit-01 Vanguard · SMA cross</legend>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Fast</span>
            <input className={field} type="number" min="2" value={p.sma.fast} onChange={n((v) => ({ ...p, sma: { ...p.sma, fast: v } }))} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Slow</span>
            <input className={field} type="number" min="3" value={p.sma.slow} onChange={n((v) => ({ ...p, sma: { ...p.sma, slow: v } }))} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Cross within</span>
            <input className={field} type="number" min="1" value={p.sma.crossLookback} onChange={n((v) => ({ ...p, sma: { ...p.sma, crossLookback: v } }))} />
          </label>
        </fieldset>
        <fieldset className="grid grid-cols-3 gap-3 border border-alert/40 p-3">
          <legend className="hud px-1 text-[12px] text-alert">Unit-02 Recoil · RSI revert</legend>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Period</span>
            <input className={field} type="number" min="2" value={p.rsi.period} onChange={n((v) => ({ ...p, rsi: { ...p.rsi, period: v } }))} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Buy below</span>
            <input className={field} type="number" min="1" max="99" value={p.rsi.entry} onChange={n((v) => ({ ...p, rsi: { ...p.rsi, entry: v } }))} />
          </label>
          <label className="grid gap-1">
            <span className="hud text-[11px] text-muted">Sell above</span>
            <input className={field} type="number" min="1" max="99" value={p.rsi.exit} onChange={n((v) => ({ ...p, rsi: { ...p.rsi, exit: v } }))} />
          </label>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <label className="grid w-40 gap-1">
          <span className="hud text-[11px] text-muted">Protective stop %</span>
          <input
            className={field}
            type="number"
            step="0.5"
            min="0.5"
            max="50"
            value={+(p.stopLossPct * 100).toFixed(2)}
            onChange={n((v) => ({ ...p, stopLossPct: v / 100 }))}
          />
        </label>
        <div className="grid gap-2 pb-1">
          {toggle("stocksEnabled", "Equity entries")}
          {toggle("cryptoEnabled", "Crypto entries")}
        </div>
        <p className="max-w-sm pb-1 text-[12px] text-muted">
          Safing a theater stops new entries only. Open positions still exit on signals and stops.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="hud text-[11px] text-muted">ADMIN_SECRET</span>
          <input
            className={`${field} w-72`}
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="required to apply"
          />
        </label>
        <button
          onClick={save}
          disabled={!secret || pending}
          className="hud slant bg-amber px-6 py-2 text-[15px] text-[#0b0a10] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <span className="unslant inline-block">{pending ? "Applying…" : "Apply to live units"}</span>
        </button>
        <button
          onClick={() => setP(current)}
          disabled={pending}
          className="hud border border-line-2 px-4 py-2 text-[13px] text-ink-2 hover:border-amber hover:text-amber disabled:opacity-40"
        >
          Revert
        </button>
        <Link href="/simulator" className="hud pb-2 text-[13px] text-amber hover:underline">
          Simulate first →
        </Link>
      </div>
      {msg && <p className={`text-[13px] ${msg.ok ? "text-sync" : "text-alert"}`}>{msg.text}</p>}
    </div>
  );
}
