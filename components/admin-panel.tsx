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
    <details className="rounded-xl border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-medium">Admin</summary>
      <div className="mt-3 grid gap-3">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="ADMIN_SECRET"
          autoComplete="off"
          className="w-full max-w-sm rounded-md border border-line bg-page px-3 py-1.5 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {BUTTONS.map((b) => (
            <button
              key={b.action}
              onClick={() => run(b.action)}
              disabled={!secret || pending}
              className={`rounded-md border px-3 py-1.5 text-sm disabled:opacity-40 ${
                b.danger ? "border-down/50 text-down" : "border-line text-ink hover:bg-surface-2"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        {output && (
          <pre className="max-h-80 overflow-auto rounded-md bg-surface-2 p-3 text-xs text-ink-2">{output}</pre>
        )}
      </div>
    </details>
  );
}
