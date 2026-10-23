import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time check of `Authorization: Bearer <secret>` against an env var. */
export function hasBearer(req: Request, envVar: "CRON_SECRET" | "ADMIN_SECRET") {
  const secret = process.env[envVar];
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(digest(token), digest(secret));
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401 });
