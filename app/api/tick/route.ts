import { revalidateTag } from "next/cache";
import { hasBearer, unauthorized } from "@/lib/auth";
import { runTick } from "@/lib/engine";

export const maxDuration = 60;

/** One bot cycle. Called every 15 minutes by GitHub Actions. `?dryRun=1` never places orders. */
export async function POST(req: Request) {
  if (!hasBearer(req, "CRON_SECRET")) return unauthorized();
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  const result = await runTick({ dryRun });
  revalidateTag("bot", { expire: 0 }); // next visitor sees this tick, not the previous one
  return Response.json(result, { status: result.status === "error" ? 500 : 200 });
}
