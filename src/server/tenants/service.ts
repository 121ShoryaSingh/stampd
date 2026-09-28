import "server-only";
import { sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { tenants, memberships, type Role } from "@/server/db/schema";
import { ValidationError } from "@/server/errors";
import { slugify, type UserTenant } from "./pick";

export type { UserTenant } from "./pick";

export async function createTenant(input: { userId: string; name: string }): Promise<{ id: string; slug: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) throw new ValidationError("Workspace name must be between 2 and 60 characters");
  const id = uuidv7();
  // Random tail of the id keeps slugs unique.
  const slug = `${slugify(name)}-${id.replace(/-/g, "").slice(-6)}`;
  await withTenant(id, async (tx) => {
    await tx.insert(tenants).values({ id, name, slug });
    await tx.insert(memberships).values({ tenantId: id, userId: input.userId, role: "admin" });
  });
  return { id, slug };
}

export async function listUserTenants(userId: string): Promise<UserTenant[]> {
  const rows = await db.execute<{ tenant_id: string; name: string; slug: string; role: Role }>(
    sql`select * from user_tenants(${userId})`,
  );
  return rows.map((r) => ({ tenantId: r.tenant_id, name: r.name, slug: r.slug, role: r.role }));
}
