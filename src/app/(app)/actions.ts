"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/server/auth/session";
import { listUserTenants } from "@/server/tenants/service";
import { setActiveTenantCookie } from "@/server/tenants/current";

export async function switchWorkspaceAction(form: FormData) {
  const session = await requireSession();
  const tenantId = z.string().uuid().parse(form.get("tenantId"));
  const mine = await listUserTenants(session.user.id);
  if (!mine.some((t) => t.tenantId === tenantId)) return; // not a member: ignore
  await setActiveTenantCookie(tenantId);
  revalidatePath("/", "layout");
}
