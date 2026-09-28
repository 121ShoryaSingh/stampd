import "server-only";
import { randomBytes } from "node:crypto";
import { withTenant } from "@/server/db/context";
import { appendAudit } from "@/server/audit/service";
import { hashToken } from "@/server/team/service";
import { env } from "@/server/env";
import { ValidationError } from "@/server/errors";
import { lockDraft } from "./service";

export type SendOptions = { expiresInDays: number; reminderEveryDays: number | null; message?: string | null };

export function signingUrl(token: string) {
  return `${env.BETTER_AUTH_URL}/sign/${token}`;
}

function checkOptions(o: SendOptions) {
  if (!Number.isInteger(o.expiresInDays) || o.expiresInDays < 1 || o.expiresInDays > 365) {
    throw new ValidationError("Envelopes must expire in 1 to 365 days");
  }
  if (o.reminderEveryDays !== null && (!Number.isInteger(o.reminderEveryDays) || o.reminderEveryDays < 1 || o.reminderEveryDays > 30)) {
    throw new ValidationError("Reminders must be every 1 to 30 days, or off");
  }
  return { ...o, message: o.message?.trim().slice(0, 2000) || null };
}

export async function sendEnvelope(i: { tenantId: string; userId: string; envelopeId: string } & SendOptions) {
  const o = checkOptions(i);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId); // a second concurrent send waits here, then sees "sent"
    const doc = await tx.document.findUnique({ where: { envelopeId: i.envelopeId } });
    if (!doc) throw new ValidationError("Upload a PDF before sending");
    const recs = await tx.recipient.findMany({ where: { envelopeId: i.envelopeId }, include: { fields: { where: { type: "signature" }, select: { id: true } } } });
    const signers = recs.filter((r) => r.role === "signer");
    if (signers.length === 0) throw new ValidationError("Add at least one signer");
    for (const s of signers) {
      if (s.fields.length === 0) throw new ValidationError(`${s.email} needs at least one signature field`);
    }
    const firstStep = Math.min(...signers.map((s) => s.routingOrder));
    const now = new Date();
    const links = [];
    for (const r of recs) {
      const token = randomBytes(32).toString("base64url");
      const isFirst = r.role === "signer" && r.routingOrder === firstStep;
      await tx.recipient.update({ where: { id: r.id }, data: { tokenHash: hashToken(token), status: isFirst ? "sent" : "pending" } });
      links.push({ recipientId: r.id, email: r.email, name: r.name, routingOrder: r.routingOrder, url: signingUrl(token) });
    }
    await tx.envelope.update({
      where: { id: i.envelopeId },
      data: {
        status: "sent",
        sentAt: now,
        expiresAt: new Date(now.getTime() + o.expiresInDays * 86_400_000),
        reminderEveryDays: o.reminderEveryDays,
        message: o.message,
      },
    });
    await appendAudit(tx, {
      tenantId: i.tenantId,
      envelopeId: i.envelopeId,
      actorType: "user",
      actorId: i.userId,
      event: "sent",
      data: { documentSha256: doc.sha256, signers: signers.length, expiresInDays: o.expiresInDays, reminderEveryDays: o.reminderEveryDays },
    });
    return links;
  });
}
