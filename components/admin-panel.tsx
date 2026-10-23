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
    <details className="panel group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[13px] font-semibold text-ink">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">›</span>
        Admin
        <span className="text-xs font-normal text-muted">requires ADMIN_SECRET</span>
      </summary>
      <div className="grid grid-cols-1 gap-3 border-t border-line p-5">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="ADMIN_SECRET"
          autoComplete="off"
          className="num w-full max-w-sm rounded-md border border-line-2 bg-page px-3 py-2 text-[13px] text-ink placeholder:text-muted"
        />
        <div className="flex flex-wrap gap-2">
          {BUTTONS.map((b) => (
            <button
              key={b.action}
              onClick={() => run(b.action)}
              disabled={!secret || pending}
              className={`rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40 ${
                b.danger
                  ? "border-loss/40 text-loss hover:bg-loss/10"
                  : "border-line-2 bg-surface-2 text-ink hover:border-accent/50"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        {output && (
          <pre className="num max-h-80 overflow-auto rounded-md border border-line bg-page p-3 text-xs text-ink-2">{output}</pre>
        )}
      </div>
    </details>
  );
}
