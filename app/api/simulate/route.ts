import { revalidateTag } from "next/cache";
import { hasBearer, unauthorized } from "@/lib/auth";
import { runSimulation, SimParams } from "@/lib/simulator";

// 12 months of 15-minute bars for 13 symbols takes ~20–40s to fetch and replay.
export const maxDuration = 300;

/** Run a simulation (costs Alpaca API calls, so it needs ADMIN_SECRET). Results are public. */
export async function POST(req: Request) {
  if (!hasBearer(req, "ADMIN_SECRET")) return unauthorized();
  const parsed = SimParams.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  }
  try {
    const { id, result, bars } = await runSimulation(parsed.data);
    revalidateTag("bot", { expire: 0 });
    return Response.json({ id, bars, summary: result.summary });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
