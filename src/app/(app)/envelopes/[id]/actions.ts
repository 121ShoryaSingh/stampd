"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { deleteDraft, finalizeUpload, resendInvite, voidEnvelope } from "@/server/envelopes/service";
import { sendEnvelope } from "@/server/envelopes/send";
import { DomainError } from "@/server/errors";

async function guard<T>(fn: () => Promise<T>): Promise<{ error?: string; data?: T }> {
  try {
    return { data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function finalizeUploadAction(envelopeId: string, key: string, filename: string) {
  const { session, tenant } = await requireTenant();
  const p = z.object({ envelopeId: z.string().uuid(), key: z.string().max(300), filename: z.string().max(300) }).parse({ envelopeId, key, filename });
  const res = await guard(() => finalizeUpload({ tenantId: tenant.tenantId, userId: session.user.id, ...p }));
  revalidatePath(`/envelopes/${envelopeId}`);
  return { error: res.error };
}

export async function sendAction(_prev: { error?: string; invited?: number }, form: FormData): Promise<{ error?: string; invited?: number }> {
  const { session, tenant } = await requireTenant();
  const p = z
    .object({
      envelopeId: z.string().uuid(),
      expiresInDays: z.coerce.number().int(),
      reminderEveryDays: z.coerce.number().int(),
      message: z.string().max(5000),
    })
    .safeParse({
      envelopeId: form.get("envelopeId"),
      expiresInDays: form.get("expiresInDays"),
      reminderEveryDays: form.get("reminderEveryDays"),
      message: form.get("message") ?? "",
    });
  if (!p.success) return { error: "Check the send options" };
  const res = await guard(() =>
    sendEnvelope({
      tenantId: tenant.tenantId,
      userId: session.user.id,
      envelopeId: p.data.envelopeId,
      expiresInDays: p.data.expiresInDays,
      reminderEveryDays: p.data.reminderEveryDays === 0 ? null : p.data.reminderEveryDays,
      message: p.data.message,
    }),
  );
  if (res.error) return { error: res.error };
  revalidatePath(`/envelopes/${p.data.envelopeId}`);
  return { invited: res.data!.invited };
}

export async function voidAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const envelopeId = z.string().uuid().parse(form.get("envelopeId"));
  const res = await guard(() =>
    voidEnvelope({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId, reason: String(form.get("reason") ?? "") }),
  );
  if (res.error) redirect(`/envelopes/${envelopeId}?error=${encodeURIComponent(res.error)}`);
  revalidatePath(`/envelopes/${envelopeId}`);
}

export async function resendAction(envelopeId: string, recipientId: string) {
  const { session, tenant } = await requireTenant();
  const p = z.object({ envelopeId: z.string().uuid(), recipientId: z.string().uuid() }).parse({ envelopeId, recipientId });
  const res = await guard(() => resendInvite({ tenantId: tenant.tenantId, userId: session.user.id, ...p }));
  revalidatePath(`/envelopes/${p.envelopeId}`);
  return { error: res.error };
}

export async function deleteDraftAction(form: FormData) {
  const { tenant } = await requireTenant();
  const envelopeId = z.string().uuid().parse(form.get("envelopeId"));
  const res = await guard(() => deleteDraft({ tenantId: tenant.tenantId, envelopeId }));
  if (res.error) redirect(`/envelopes/${envelopeId}?error=${encodeURIComponent(res.error)}`);
  redirect("/dashboard");
}
