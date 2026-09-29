"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { EditorFieldSchema } from "@/lib/fields/schema";
import { requireTenant } from "@/server/tenants/current";
import { setRecipients } from "@/server/envelopes/recipients";
import { saveFields } from "@/server/envelopes/fields";
import { renameDraft } from "@/server/envelopes/service";
import { DomainError } from "@/server/errors";

const Recipient = z.object({ name: z.string().max(200), email: z.string().max(300), role: z.enum(["signer", "cc"]), routingOrder: z.number().int() });
const Field = EditorFieldSchema;

export async function saveRecipientsAction(envelopeId: string, list: unknown) {
  const { session, tenant } = await requireTenant();
  const parsed = z.object({ envelopeId: z.string().uuid(), list: z.array(Recipient).max(50) }).safeParse({ envelopeId, list });
  if (!parsed.success) return { error: "Check the recipient details" };
  try {
    const saved = await setRecipients({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, recipients: parsed.data.list });
    revalidatePath(`/envelopes/${envelopeId}`, "layout");
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
    revalidatePath(`/envelopes/${envelopeId}`, "layout");
    return { count };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

// Step 1: the title; then on to the PDF.
export async function renameAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const { session, tenant } = await requireTenant();
  const p = z.object({ envelopeId: z.string().uuid(), title: z.string().max(500) }).safeParse({ envelopeId: form.get("envelopeId"), title: form.get("title") });
  if (!p.success) return { error: "Enter a title" };
  try {
    await renameDraft({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId: p.data.envelopeId, title: p.data.title });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/envelopes/${p.data.envelopeId}`, "layout");
  redirect(`/envelopes/${p.data.envelopeId}/upload`);
}
