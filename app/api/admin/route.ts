import { revalidateTag } from "next/cache";
import { z } from "zod";
import { closeAllPositions } from "@/lib/alpaca";
import { hasBearer, unauthorized } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { runTick, setSetting } from "@/lib/engine";
import { describeChanges, getLiveParams, LiveParams, saveLiveParams } from "@/lib/live-params";

export const maxDuration = 60;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["tick", "dryRun", "pause", "resume", "liquidate"]) }),
  z.object({ action: z.literal("tune"), params: LiveParams }),
]);

export async function POST(req: Request) {
  if (!hasBearer(req, "ADMIN_SECRET")) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  const body = parsed.data;
  let result: unknown = null;
  if (body.action === "tick" || body.action === "dryRun") {
    result = await runTick({ dryRun: body.action === "dryRun", trigger: "admin" });
  } else if (body.action === "pause" || body.action === "resume") {
    await setSetting("paused", body.action === "pause");
  } else if (body.action === "tune") {
    const before = await getLiveParams();
    const changes = describeChanges(before, body.params);
    await saveLiveParams(body.params);
    // Record the retune in the Sorties log so every change to live behavior is auditable.
    await db()
      .insert(schema.botRuns)
      .values({
        status: "config",
        trigger: "admin",
        finishedAt: new Date(),
        durationMs: 0,
        message: changes.length ? `Retuned: ${changes.join(" · ")}` : "Retune saved (no changes)",
      });
    result = { changes };
  } else {
    // Pause first so the next tick doesn't immediately re-enter.
    await setSetting("paused", true);
    await closeAllPositions();
  }
  revalidateTag("bot", { expire: 0 }); // next visitor sees this change, not the previous state
  return Response.json({ ok: true, action: body.action, result });
}
