import "server-only";
import { timingSafeEqual } from "node:crypto";
import { appendAudit } from "@/server/audit/service";
import { presignGet } from "@/server/storage/storage";
import { enqueueEmail } from "@/server/email/outbox";
import { ForbiddenError, ValidationError } from "@/server/errors";
import type { PageSize } from "@/server/db/types";
import { inTenant, loadSigner, requireReady, resolveSigner, type ReqMeta, type SignerRef } from "./access";
import { hashCode, newCode, OTP_MAX_ATTEMPTS, OTP_RESEND_MS, OTP_TTL_MS } from "./otp";
import { isValidSession } from "./session";

const audit = (ref: SignerRef, event: string, meta: ReqMeta, data: Record<string, unknown> = {}) => ({
  tenantId: ref.tenantId,
  envelopeId: ref.envelopeId,
  actorType: "recipient" as const,
  actorId: ref.recipientId,
  event,
  ip: meta.ip,
  userAgent: meta.userAgent,
  data,
});

export async function openLink(token: string, meta: ReqMeta) {
  const ref = await resolveSigner(token);
  return inTenant(ref, async (tx) => {
    const { rec, env, state } = await loadSigner(tx, ref);
    if (state === "ready" && rec.status === "sent") {
      // Only the first open flips sent -> viewed, so "viewed" is logged once.
      const first = await tx.recipient.updateMany({ where: { id: rec.id, status: "sent" }, data: { status: "viewed", viewedAt: new Date() } });
      if (first.count === 1) await appendAudit(tx, audit(ref, "viewed", meta));
    }
    return {
      ref,
      state,
      name: rec.name,
      email: rec.email,
      title: env.title,
      senderMessage: env.message,
      verified: !!rec.otpVerifiedAt,
      otpVerifiedAt: rec.otpVerifiedAt,
      consented: !!rec.consentedAt,
    };
  });
}

export async function requestCode(token: string, meta: ReqMeta): Promise<{ email: string }> {
  const ref = await resolveSigner(token);
  const code = newCode();
  return inTenant(ref, async (tx) => {
    const { rec, env } = await requireReady(tx, ref);
    const now = new Date();
    // Atomic resend limit: only one request wins per 30 seconds.
    const claimed = await tx.recipient.updateMany({
      where: { id: ref.recipientId, OR: [{ otpSentAt: null }, { otpSentAt: { lt: new Date(now.getTime() - OTP_RESEND_MS) } }] },
      data: { otpHash: hashCode(ref.recipientId, code), otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS), otpAttempts: 0, otpSentAt: now },
    });
    if (claimed.count === 0) throw new ValidationError("Please wait a moment before requesting another code");
    await appendAudit(tx, audit(ref, "otp_sent", meta));
    await enqueueEmail(tx, {
      tenantId: ref.tenantId,
      envelopeId: ref.envelopeId,
      recipientId: ref.recipientId,
      kind: "otp",
      toEmail: rec.email,
      toName: rec.name,
      data: { title: env.title, code },
    });
    return { email: rec.email };
  });
}

export async function verifyCode(token: string, code: string, meta: ReqMeta): Promise<{ recipientId: string; verifiedAt: Date }> {
  const ref = await resolveSigner(token);
  // Commit attempt counting even when the code is wrong, then report the outcome.
  const outcome = await inTenant(ref, async (tx) => {
    const { rec } = await requireReady(tx, ref);
    if (!rec.otpHash) return { error: "Request a code first" };
    if (!rec.otpExpiresAt || rec.otpExpiresAt <= new Date()) return { error: "This code expired, request a new one" };
    const counted = await tx.recipient.updateMany({
      where: { id: rec.id, otpHash: rec.otpHash, otpAttempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { otpAttempts: { increment: 1 } },
    });
    if (counted.count === 0) return { error: "Too many attempts, request a new code" };
    const a = Buffer.from(hashCode(rec.id, code.trim()));
    const b = Buffer.from(rec.otpHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await appendAudit(tx, audit(ref, "otp_failed", meta));
      return { error: "Wrong code" };
    }
    const verifiedAt = new Date();
    await tx.recipient.update({ where: { id: rec.id }, data: { otpVerifiedAt: verifiedAt, otpHash: null, otpExpiresAt: null } });
    await appendAudit(tx, audit(ref, "otp_verified", meta));
    return { verifiedAt };
  });
  if ("error" in outcome) throw new ValidationError(outcome.error as string);
  return { recipientId: ref.recipientId, verifiedAt: outcome.verifiedAt };
}

export async function requireSignerSession(token: string, session: string | undefined) {
  const ref = await resolveSigner(token);
  const found = await inTenant(ref, (tx) => requireReady(tx, ref));
  if (!isValidSession(session, found.rec.id, found.rec.otpVerifiedAt)) {
    throw new ForbiddenError("Your session ended. Please verify your code again.");
  }
  return { ref, ...found };
}

export async function giveConsent(token: string, session: string | undefined, meta: ReqMeta) {
  const { ref } = await requireSignerSession(token, session);
  await inTenant(ref, async (tx) => {
    const first = await tx.recipient.updateMany({ where: { id: ref.recipientId, consentedAt: null }, data: { consentedAt: new Date() } });
    if (first.count === 1) await appendAudit(tx, audit(ref, "consented", meta, { text: "I agree to use electronic records and signatures." }));
  });
}

export async function getSigningView(token: string, session: string | undefined) {
  const { ref, rec, env } = await requireSignerSession(token, session);
  if (!rec.consentedAt) throw new ValidationError("Please agree to sign electronically first (consent)");
  const { doc, fields } = await inTenant(ref, async (tx) => ({
    doc: await tx.document.findUniqueOrThrow({ where: { envelopeId: ref.envelopeId } }),
    fields: await tx.field.findMany({
      where: { recipientId: ref.recipientId },
      orderBy: [{ page: "asc" }, { y: "asc" }, { x: "asc" }],
      select: { id: true, type: true, page: true, x: true, y: true, w: true, h: true, required: true },
    }),
  }));
  return { title: env.title, name: rec.name, pdfUrl: await presignGet(doc.s3Key, 3600), pageSizes: doc.pageSizes as PageSize[], fields };
}
