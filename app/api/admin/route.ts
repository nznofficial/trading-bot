import { revalidateTag } from "next/cache";
import { z } from "zod";
import { closeAllPositions } from "@/lib/alpaca";
import { hasBearer, unauthorized } from "@/lib/auth";
import { runTick, setSetting } from "@/lib/engine";

export const maxDuration = 60;

const Body = z.object({ action: z.enum(["tick", "dryRun", "pause", "resume", "liquidate"]) });

export async function POST(req: Request) {
  if (!hasBearer(req, "ADMIN_SECRET")) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid action" }, { status: 400 });

  const { action } = parsed.data;
  let result: unknown = null;
  if (action === "tick" || action === "dryRun") {
    result = await runTick({ dryRun: action === "dryRun" });
  } else if (action === "pause" || action === "resume") {
    await setSetting("paused", action === "pause");
  } else {
    // Pause first so the next tick doesn't immediately re-enter.
    await setSetting("paused", true);
    await closeAllPositions();
  }
  revalidateTag("bot", { expire: 0 }); // next visitor sees this tick, not the previous one
  return Response.json({ ok: true, action, result });
}
