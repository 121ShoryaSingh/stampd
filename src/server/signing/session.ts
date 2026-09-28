import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

export const SESSION_TTL_MS = 7_200_000;
export const sessionCookieName = (recipientId: string) => `sg_${recipientId.replace(/-/g, "")}`;

// Bound to the verification time, so verifying a new code invalidates old sessions.
export function signerSessionValue(recipientId: string, verifiedAt: Date): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`sess|${recipientId}|${verifiedAt.toISOString()}`).digest("base64url");
}

export function isValidSession(value: string | undefined, recipientId: string, verifiedAt: Date | null, now = new Date()): boolean {
  if (!value || !verifiedAt) return false;
  if (now.getTime() - verifiedAt.getTime() > SESSION_TTL_MS) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(signerSessionValue(recipientId, verifiedAt));
  return a.length === b.length && timingSafeEqual(a, b);
}
