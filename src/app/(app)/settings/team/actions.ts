"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { createInvitation, changeRole, inviteUrl, removeMember, revokeInvitation } from "@/server/team/service";
import { DomainError } from "@/server/errors";

type State = { error?: string; inviteUrl?: string; invited?: string };
const RoleSchema = z.enum(["admin", "member"]);

export async function inviteAction(_prev: State, form: FormData): Promise<State> {
  const { session, tenant } = await requireTenant();
  const parsed = z
    .object({ email: z.string().max(254), role: RoleSchema })
    .safeParse({ email: form.get("email"), role: form.get("role") });
  if (!parsed.success) return { error: "Enter an email and a role" };
  try {
    const { token } = await createInvitation({ tenantId: tenant.tenantId, actorUserId: session.user.id, ...parsed.data });
    revalidatePath("/settings/team");
    // Emailed by the worker; the link is also shown once so it can be shared another way.
    return { invited: parsed.data.email.trim().toLowerCase(), inviteUrl: inviteUrl(token) };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

// Shows domain errors as a banner on the team page.
async function run(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof DomainError) redirect(`/settings/team?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/settings/team");
}

export async function changeRoleAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const targetUserId = z.string().min(1).parse(form.get("userId"));
  const role = RoleSchema.parse(form.get("role"));
  await run(() => changeRole({ tenantId: tenant.tenantId, actorUserId: session.user.id, targetUserId, role }));
}

export async function removeMemberAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const targetUserId = z.string().min(1).parse(form.get("userId"));
  await run(() => removeMember({ tenantId: tenant.tenantId, actorUserId: session.user.id, targetUserId }));
  if (targetUserId === session.user.id) redirect("/dashboard");
}

export async function revokeInviteAction(form: FormData) {
  const { session, tenant } = await requireTenant();
  const invitationId = z.string().uuid().parse(form.get("invitationId"));
  await run(() => revokeInvitation({ tenantId: tenant.tenantId, actorUserId: session.user.id, invitationId }));
}
