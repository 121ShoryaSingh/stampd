import "server-only";
import { headers } from "next/headers";
import type { ReqMeta } from "./access";

// Client IP (first proxy hop) and user agent for the audit trail.
export async function requestMeta(): Promise<ReqMeta> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}
