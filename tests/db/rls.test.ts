import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql as dsql } from "drizzle-orm";
import { migratorSql, insertUser, insertTenant } from "../helpers/db";
import { db } from "@/server/db/client";
import { withTenant } from "@/server/db/tenant";
import { tenants, memberships, invitations } from "@/server/db/schema";

const admin = migratorSql();
let a: string, b: string, userA: { id: string }, userB: { id: string };

beforeAll(async () => {
  a = await insertTenant(admin, "Alpha");
  b = await insertTenant(admin, "Beta");
  userA = await insertUser(admin);
  userB = await insertUser(admin);
  await admin`insert into memberships (tenant_id, user_id, role) values (${a}, ${userA.id}, 'admin'), (${b}, ${userB.id}, 'admin')`;
  await admin`insert into invitations (id, tenant_id, email, role, token_hash, invited_by, expires_at)
              values (gen_random_uuid(), ${b}, 'x@beta.dev', 'member', ${"h-" + b}, ${userB.id}, now() + interval '1 day')`;
});
afterAll(async () => {
  await admin.end();
});

describe("row-level security", () => {
  it("sees only its own tenant row", async () => {
    const rows = await withTenant(a, (tx) => tx.select().from(tenants));
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it("sees only its own memberships and invitations", async () => {
    const [m, i] = await withTenant(a, async (tx) => [await tx.select().from(memberships), await tx.select().from(invitations)]);
    expect(m.every((r) => r.tenantId === a)).toBe(true);
    expect(i).toHaveLength(0);
  });

  it("cannot insert a row for another tenant", async () => {
    await expect(
      withTenant(a, (tx) => tx.insert(memberships).values({ tenantId: b, userId: userA.id, role: "member" })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } });
  });

  it("cannot update another tenant's rows", async () => {
    await withTenant(a, (tx) => tx.update(tenants).set({ name: "hacked" }).where(dsql`true`));
    const [row] = await admin`select name from tenants where id = ${b}`;
    expect(row.name).toBe("Beta");
  });

  it("returns nothing outside withTenant (no tenant set)", async () => {
    expect(await db.select().from(tenants)).toHaveLength(0);
  });

  it("user_tenants lists only that user's workspaces", async () => {
    const rows = await db.execute(dsql`select * from user_tenants(${userA.id})`);
    expect(rows.map((r) => r.tenant_id)).toEqual([a]);
  });

  it("resolve_invitation finds a valid token across tenants and nothing for a bad one", async () => {
    const ok = await db.execute(dsql`select * from resolve_invitation(${"h-" + b})`);
    const bad = await db.execute(dsql`select * from resolve_invitation(${"nope"})`);
    expect(ok[0]?.tenant_id).toBe(b);
    expect(bad).toHaveLength(0);
  });

  it("rejects a malformed tenant id", async () => {
    await expect(withTenant("' or 1=1 --", async () => 1)).rejects.toThrow(/Invalid workspace id/);
  });
});
