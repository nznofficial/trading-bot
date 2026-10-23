"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Action = "tick" | "dryRun" | "pause" | "resume" | "liquidate";

const BUTTONS: { action: Action; label: string; danger?: boolean }[] = [
  { action: "dryRun", label: "Simulate sortie (dry run)" },
  { action: "tick", label: "Launch sortie now" },
  { action: "pause", label: "Hold units (pause)" },
  { action: "resume", label: "Resume" },
  { action: "liquidate", label: "Eject (liquidate all)", danger: true },
];

/** The secret is held in component state only; it is never stored. */
export function AdminPanel() {
  const [secret, setSecret] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: Action) {
    if (action === "liquidate" && !confirm("Eject: close every position and pause the bot?")) return;
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
    <div className="frame frame-amber">
      <details className="frame-body group">
        <summary className="hud flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-[14px] text-amber">
          <span aria-hidden className="hazard inline-block h-3 w-6" />
          Command override
          <span className="text-[11px] text-muted">requires ADMIN_SECRET</span>
          <span aria-hidden className="ml-auto text-muted transition-transform group-open:rotate-90">
            ▸
          </span>
        </summary>
        <div className="grid grid-cols-1 gap-3 border-t border-line p-5">
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="ADMIN_SECRET"
            autoComplete="off"
            className="num w-full max-w-sm border border-line-2 bg-page px-3 py-2 text-[13px] text-ink placeholder:text-muted focus:border-amber"
          />
          <div className="flex flex-wrap gap-2">
            {BUTTONS.map((b) => (
              <button
                key={b.action}
                onClick={() => run(b.action)}
                disabled={!secret || pending}
                className={`hud border px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-40 ${
                  b.danger
                    ? "border-alert/60 text-alert hover:bg-alert/15"
                    : "border-line-2 bg-surface-2 text-ink hover:border-amber hover:text-amber"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          {output && (
            <pre className="num max-h-80 overflow-auto border border-line bg-page p-3 text-xs text-ink-2">{output}</pre>
          )}
        </div>
      </details>
    </div>
  );
}
