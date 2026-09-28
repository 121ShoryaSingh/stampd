import "server-only";
import { uuidv7 } from "uuidv7";
import { withDb } from "@/server/db/context";
import { ValidationError } from "@/server/errors";
import { slugify, type UserTenant } from "./pick";

export type { UserTenant } from "./pick";

export async function createTenant(input: { userId: string; name: string }): Promise<{ id: string; slug: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new ValidationError("Workspace name must be between 2 and 60 characters");
  const id = uuidv7();
  // Random tail of the id keeps slugs unique.
  const slug = `${slugify(name)}-${id.replace(/-/g, "").slice(-6)}`;
  await withDb({ tenantId: id }, (tx) =>
    tx.tenant.create({ data: { id, name, slug, memberships: { create: { userId: input.userId, role: "admin" } } } }),
  );
  return { id, slug };
}

export async function listUserTenants(userId: string): Promise<UserTenant[]> {
  const rows = await withDb({ userId }, (tx) =>
    tx.membership.findMany({ where: { userId }, include: { tenant: true }, orderBy: { tenant: { createdAt: "asc" } } }),
  );
  return rows.map((m) => ({ tenantId: m.tenantId, name: m.tenant.name, slug: m.tenant.slug, role: m.role }));
}
