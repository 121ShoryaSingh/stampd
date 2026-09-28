import "server-only";
import { withTenant } from "@/server/db/context";
import { appendAudit } from "@/server/audit/service";
import { normalizeEmail } from "@/server/team/email";
import { ValidationError } from "@/server/errors";
import { lockDraft } from "./service";

export const MAX_RECIPIENTS = 20;
export type RecipientInput = { name: string; email: string; role: "signer" | "cc"; routingOrder: number };

function clean(list: RecipientInput[]) {
  if (list.length > MAX_RECIPIENTS) throw new ValidationError(`An envelope can have at most ${MAX_RECIPIENTS} recipients`);
  const seen = new Set<string>();
  return list.map((r) => {
    const name = r.name.trim().replace(/\s+/g, " ");
    if (name.length < 1 || name.length > 120) throw new ValidationError("Every recipient needs a name");
    const email = normalizeEmail(r.email);
    if (seen.has(email)) throw new ValidationError(`${email} is listed more than once`);
    seen.add(email);
    if (!Number.isInteger(r.routingOrder) || r.routingOrder < 1 || r.routingOrder > MAX_RECIPIENTS) {
      throw new ValidationError("Signing order must be a number from 1 to 20");
    }
    if (r.role !== "signer" && r.role !== "cc") throw new ValidationError("Role must be signer or cc");
    return { name, email, role: r.role, routingOrder: r.routingOrder };
  });
}

export async function setRecipients(i: { tenantId: string; userId: string; envelopeId: string; recipients: RecipientInput[] }) {
  const list = clean(i.recipients);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    // Removing a recipient also removes their fields (cascade).
    await tx.recipient.deleteMany({ where: { envelopeId: i.envelopeId, email: { notIn: list.map((r) => r.email) } } });
    const out: { id: string; email: string }[] = [];
    for (const r of list) {
      const row = await tx.recipient.upsert({
        where: { envelopeId_email: { envelopeId: i.envelopeId, email: r.email } },
        create: { tenantId: i.tenantId, envelopeId: i.envelopeId, ...r },
        update: { name: r.name, role: r.role, routingOrder: r.routingOrder },
        select: { id: true, email: true },
      });
      out.push(row);
    }
    // CC recipients never sign, so they cannot keep fields.
    await tx.field.deleteMany({ where: { envelopeId: i.envelopeId, recipient: { role: "cc" } } });
    await appendAudit(tx, {
      tenantId: i.tenantId,
      envelopeId: i.envelopeId,
      actorType: "user",
      actorId: i.userId,
      event: "recipients_updated",
      data: { recipients: list.map((r) => ({ email: r.email, role: r.role, order: r.routingOrder })) },
    });
    return out;
  });
}
