"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { createEnvelope } from "@/server/envelopes/service";
import { DomainError } from "@/server/errors";

export async function createEnvelopeAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const { session, tenant } = await requireTenant();
  const title = z.string().max(500).safeParse(form.get("title"));
  if (!title.success) return { error: "Enter a title" };
  let id: string;
  try {
    ({ id } = await createEnvelope({ tenantId: tenant.tenantId, userId: session.user.id, title: title.data }));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  redirect(`/envelopes/${id}`);
}
