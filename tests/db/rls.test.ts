import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../helpers/db";
import { withDb, withTenant } from "@/server/db/context";
import { prisma } from "@/server/db/client";

const admin = adminDb();
let a: string, b: string, userA: { id: string }, userB: { id: string };

beforeAll(async () => {
  a = await insertTenant(admin, "Alpha");
  b = await insertTenant(admin, "Beta");
  userA = await insertUser(admin);
  userB = await insertUser(admin);
  await admin.membership.createMany({ data: [{ tenantId: a, userId: userA.id, role: "admin" }, { tenantId: b, userId: userB.id, role: "admin" }] });
  await admin.invitation.create({
    data: { tenantId: b, email: "x@beta.dev", role: "member", tokenHash: `h-${b}`, invitedBy: userB.id, expiresAt: new Date(Date.now() + 86_400_000) },
  });
});
afterAll(async () => {
  await admin.$disconnect();
});

describe("row-level security: tenant context", () => {
  it("sees only its own tenant row", async () => {
    const rows = await withTenant(a, (tx) => tx.tenant.findMany());
    expect(rows.map((r) => r.id)).toEqual([a]);
  });

  it("sees only its own memberships and invitations", async () => {
    const [m, i] = await withTenant(a, async (tx) => [await tx.membership.findMany(), await tx.invitation.findMany()]);
    expect(m.every((r) => r.tenantId === a)).toBe(true);
    expect(i).toHaveLength(0);
  });

  it("cannot insert a row for another tenant", async () => {
    await expect(withTenant(a, (tx) => tx.membership.create({ data: { tenantId: b, userId: userA.id, role: "member" } }))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("cannot update another tenant's rows", async () => {
    await withTenant(a, (tx) => tx.tenant.updateMany({ data: { name: "hacked" } }));
    expect((await admin.tenant.findUniqueOrThrow({ where: { id: b } })).name).toBe("Beta");
  });

  it("sees nothing without any context", async () => {
    expect(await prisma.tenant.findMany()).toHaveLength(0);
    expect(await withDb({}, (tx) => tx.membership.findMany())).toHaveLength(0);
  });

  it("rejects a malformed tenant id", async () => {
    await expect(withTenant("' or 1=1 --", async () => 1)).rejects.toThrow(/Invalid workspace id/);
  });
});

describe("row-level security: user and token context", () => {
  it("a user reads only their own memberships and those tenants", async () => {
    const [m, t] = await withDb({ userId: userA.id }, async (tx) => [await tx.membership.findMany(), await tx.tenant.findMany()]);
    expect(m.map((r) => r.tenantId)).toEqual([a]);
    expect(t.map((r) => r.id)).toEqual([a]);
  });

  it("user context grants no writes", async () => {
    await expect(withDb({ userId: userA.id }, (tx) => tx.membership.create({ data: { tenantId: a, userId: userB.id, role: "admin" } }))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("a token hash reveals only its own invitation", async () => {
    const hit = await withDb({ tokenHash: `h-${b}` }, (tx) => tx.invitation.findMany());
    const miss = await withDb({ tokenHash: "nope" }, (tx) => tx.invitation.findMany());
    expect(hit.map((i) => i.tenantId)).toEqual([b]);
    expect(miss).toHaveLength(0);
  });
});
