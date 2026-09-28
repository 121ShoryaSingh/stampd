"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { acceptInvitation } from "@/server/team/service";
import { setActiveTenantCookie } from "@/server/tenants/current";
import { DomainError } from "@/server/errors";

export async function acceptInviteAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const token = z.string().min(20).max(200).parse(form.get("token"));
  let tenantId: string;
  try {
    ({ tenantId } = await acceptInvitation({ token, userId: session.user.id, userEmail: session.user.email }));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  await setActiveTenantCookie(tenantId);
  redirect("/dashboard");
}
