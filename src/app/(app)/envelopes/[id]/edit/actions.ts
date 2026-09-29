"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { setRecipients } from "@/server/envelopes/recipients";
import { saveFields } from "@/server/envelopes/fields";
import { DomainError } from "@/server/errors";

const Recipient = z.object({ name: z.string().max(200), email: z.string().max(300), role: z.enum(["signer", "cc"]), routingOrder: z.number().int() });
const Field = z.object({
  recipientId: z.string().uuid(),
  type: z.enum(["signature", "initials", "date", "text", "checkbox", "choice"]),
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  required: z.boolean().optional(),
});

export async function saveRecipientsAction(envelopeId: string, list: unknown) {
  const { session, tenant } = await requireTenant();
  const parsed = z.object({ envelopeId: z.string().uuid(), list: z.array(Recipient).max(50) }).safeParse({ envelopeId, list });
  if (!parsed.success) return { error: "Check the recipient details" };
  try {
    const saved = await setRecipients({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, recipients: parsed.data.list });
    revalidatePath(`/envelopes/${envelopeId}/edit`);
    return { saved };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function saveFieldsAction(envelopeId: string, list: unknown) {
  const { session, tenant } = await requireTenant();
  const parsed = z.object({ envelopeId: z.string().uuid(), list: z.array(Field).max(500) }).safeParse({ envelopeId, list });
  if (!parsed.success) return { error: "Some fields are invalid" };
  try {
    const count = await saveFields({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, fields: parsed.data.list });
    revalidatePath(`/envelopes/${envelopeId}`);
    return { count };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}
