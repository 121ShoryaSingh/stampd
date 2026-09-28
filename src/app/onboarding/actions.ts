"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { createTenant } from "@/server/tenants/service";
import { setActiveTenantCookie } from "@/server/tenants/current";
import { DomainError } from "@/server/errors";

const Input = z.object({ name: z.string().max(200) });

export async function createWorkspaceAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const session = await requireSession();
  const parsed = Input.safeParse({ name: form.get("name") });
  if (!parsed.success) return { error: "Enter a workspace name" };
  let id: string;
  try {
    ({ id } = await createTenant({ userId: session.user.id, name: parsed.data.name }));
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  await setActiveTenantCookie(id);
  redirect("/dashboard");
}
