import { revalidateTag } from "next/cache";
import { hasBearer, unauthorized } from "@/lib/auth";
import { runTick } from "@/lib/engine";

export const maxDuration = 60;

/** Where a run came from, for the Sorties log: an explicit X-Trigger header, else the User-Agent. */
function triggerOf(req: Request) {
  const explicit = req.headers.get("x-trigger");
  if (explicit) return explicit.slice(0, 40);
  const ua = (req.headers.get("user-agent") ?? "").toLowerCase();
  return ua.includes("cron-job.org") ? "cron-job.org" : "manual";
}

/** One bot cycle. Called every 15 minutes by GitHub Actions. `?dryRun=1` never places orders. */
export async function POST(req: Request) {
  if (!hasBearer(req, "CRON_SECRET")) return unauthorized();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const result = await runTick({ dryRun, trigger: triggerOf(req) });
  revalidateTag("bot", { expire: 0 }); // next visitor sees this tick, not the previous one
  return Response.json(result, { status: result.status === "error" ? 500 : 200 });
}
