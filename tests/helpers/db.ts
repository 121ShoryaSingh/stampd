import { inject } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type AdminDb = PrismaClient;

// Migrator connection (BYPASSRLS) for seeding and asserting. Close with `await db.$disconnect()`.
export function adminDb(): AdminDb {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: inject("migratorDbUrl"), max: 2 }) });
}

export async function insertUser(db: AdminDb, email = `u-${randomUUID()}@test.dev`) {
  const id = randomUUID();
  await db.user.create({ data: { id, name: `Test ${id.slice(0, 4)}`, email } });
  return { id, email };
}

export async function insertTenant(db: AdminDb, name = "Acme") {
  const t = await db.tenant.create({ data: { name, slug: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}` } });
  return t.id;
}
