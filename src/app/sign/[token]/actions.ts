"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { resolveSigner } from "@/server/signing/access";
import { requestMeta } from "@/server/signing/meta";
import { requestCode, verifyCode, giveConsent } from "@/server/signing/service";
import { submitSigning, declineSigning } from "@/server/signing/submit";
import { sessionCookieName, signerSessionValue, SESSION_TTL_MS } from "@/server/signing/session";
import { DomainError } from "@/server/errors";

const Token = z.string().min(20).max(200);

async function sessionFor(token: string) {
  const ref = await resolveSigner(token);
  return (await cookies()).get(sessionCookieName(ref.recipientId))?.value;
}

async function guard<T>(fn: () => Promise<T>): Promise<{ error?: string; data?: T }> {
  try {
    return { data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function requestCodeAction(token: string) {
  const t = Token.parse(token);
  const res = await guard(async () => requestCode(t, await requestMeta()));
  return res.error ? { error: res.error } : { devCode: res.data!.devCode };
}

export async function verifyCodeAction(token: string, code: string) {
  const t = Token.parse(token);
  const c = z.string().regex(/^\s*\d{6}\s*$/).safeParse(code);
  if (!c.success) return { error: "Enter the 6-digit code" };
  const res = await guard(async () => verifyCode(t, c.data, await requestMeta()));
  if (res.error) return { error: res.error };
  const { recipientId, verifiedAt } = res.data!;
  (await cookies()).set(sessionCookieName(recipientId), signerSessionValue(recipientId, verifiedAt), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/sign",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return {};
}

export async function consentAction(token: string) {
  const t = Token.parse(token);
  const res = await guard(async () => giveConsent(t, await sessionFor(t), await requestMeta()));
  return { error: res.error };
}

const Submit = z.object({
  values: z.record(z.string().uuid(), z.string().max(1000)),
  signaturePng: z.string().max(500_000).optional(),
  initialsPng: z.string().max(500_000).optional(),
});

export async function submitAction(token: string, input: unknown) {
  const t = Token.parse(token);
  const parsed = Submit.safeParse(input);
  if (!parsed.success) return { error: "Some answers are invalid" };
  const res = await guard(async () => submitSigning(t, await sessionFor(t), parsed.data, await requestMeta()));
  return { error: res.error };
}

export async function declineAction(token: string, reason: string) {
  const t = Token.parse(token);
  const res = await guard(async () => declineSigning(t, await sessionFor(t), z.string().max(2000).parse(reason), await requestMeta()));
  return { error: res.error };
}
