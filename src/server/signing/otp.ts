import "server-only";
import { createHmac, randomInt } from "node:crypto";
import { env } from "@/server/env";

export const OTP_TTL_MS = 600_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 30_000;

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(recipientId: string, code: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`otp|${recipientId}|${code}`).digest("hex");
}
