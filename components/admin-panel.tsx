"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Action = "tick" | "dryRun" | "pause" | "resume" | "liquidate";

const BUTTONS: { action: Action; label: string; danger?: boolean }[] = [
  { action: "dryRun", label: "Dry run" },
  { action: "tick", label: "Run tick now" },
  { action: "pause", label: "Pause" },
  { action: "resume", label: "Resume" },
  { action: "liquidate", label: "Liquidate all", danger: true },
];

/** The secret is held in component state only; it is never stored. */
export function AdminPanel() {
  const [secret, setSecret] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: Action) {
    if (action === "liquidate" && !confirm("Close every position and pause the bot?")) return;
    startTransition(async () => {
      setOutput("…");
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setOutput(`${res.status} ${JSON.stringify(await res.json().catch(() => null), null, 2)}`);
      router.refresh();
    });
  }

  return (
    <details className="panel group p-5">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-label text-[11px] tracking-[0.18em] text-ink uppercase">
        <span aria-hidden className="text-neon transition-transform group-open:rotate-90">▸</span>
        Admin console
        <span className="label ml-2 text-[9px]!">Requires ADMIN_SECRET</span>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="ADMIN_SECRET"
          autoComplete="off"
          className="num w-full max-w-sm rounded-sm border border-line bg-[#05070a] px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-neon/60"
        />
        <div className="flex flex-wrap gap-2">
          {BUTTONS.map((b) => (
            <button
              key={b.action}
              onClick={() => run(b.action)}
              disabled={!secret || pending}
              className={`rounded-sm border px-3.5 py-2 font-label text-[10px] tracking-[0.16em] uppercase transition-colors disabled:opacity-35 ${
                b.danger
                  ? "border-loss/50 text-loss hover:bg-loss/10"
                  : "border-line text-ink hover:border-neon/50 hover:bg-neon/5 hover:text-neon"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        {output && (
          <pre className="num max-h-80 overflow-auto rounded-sm border border-line bg-[#05070a] p-3 text-xs text-ink-2">{output}</pre>
        )}
      </div>
    </details>
  );
}
