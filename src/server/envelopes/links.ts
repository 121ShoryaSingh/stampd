import "server-only";
import { randomBytes } from "node:crypto";
import type { Tx } from "@/server/db/context";
import { enqueueEmail } from "@/server/email/outbox";
import { hashToken } from "@/server/team/service";
import { env } from "@/server/env";

export function signingUrl(token: string) {
  return `${env.BETTER_AUTH_URL}/sign/${token}`;
}

export function envelopeUrl(envelopeId: string) {
  return `${env.BETTER_AUTH_URL}/envelopes/${envelopeId}`;
}

export async function senderOf(tx: Tx, envelope: { createdBy: string }) {
  return tx.user.findUniqueOrThrow({ where: { id: envelope.createdBy }, select: { name: true, email: true } });
}

type LinkEnvelope = { id: string; tenantId: string; title: string; message: string | null; expiresAt: Date | null; createdBy: string };
type LinkRecipient = { id: string; name: string; email: string };

// Only the token hash is stored, so every invite or reminder issues a fresh link; older links stop working.
export async function issueLink(tx: Tx, envelope: LinkEnvelope, r: LinkRecipient, kind: "invite" | "reminder", now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  await tx.recipient.update({
    where: { id: r.id },
    data: { tokenHash: hashToken(token), ...(kind === "invite" ? { invitedAt: now } : { lastRemindedAt: now }) },
  });
  const sender = await senderOf(tx, envelope);
  const base = {
    title: envelope.title,
    senderName: sender.name,
    recipientName: r.name,
    url: signingUrl(token),
    expiresAt: (envelope.expiresAt ?? now).toISOString(),
  };
  const common = { tenantId: envelope.tenantId, envelopeId: envelope.id, recipientId: r.id, toEmail: r.email, toName: r.name };
  if (kind === "invite") await enqueueEmail(tx, { ...common, kind, data: { ...base, message: envelope.message } });
  else await enqueueEmail(tx, { ...common, kind, data: base });
  return token;
}
