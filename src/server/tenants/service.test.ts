import { describe, it, expect, afterAll } from "vitest";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { createTenant, listUserTenants } from "./service";

const admin = migratorSql();
afterAll(async () => {
  await admin.end();
});

describe("tenant service", () => {
  it("creates a workspace with the creator as admin", async () => {
    const u = await insertUser(admin);
    const { id, slug } = await createTenant({ userId: u.id, name: "  Acme Inc " });
    expect(slug).toMatch(/^acme-inc-[0-9a-f]{6}$/);
    const list = await listUserTenants(u.id);
    expect(list).toEqual([{ tenantId: id, name: "Acme Inc", slug, role: "admin" }]);
  });

  it("lists several workspaces in creation order", async () => {
    const u = await insertUser(admin);
    const one = await createTenant({ userId: u.id, name: "One" });
    const two = await createTenant({ userId: u.id, name: "Two" });
    expect((await listUserTenants(u.id)).map((t) => t.tenantId)).toEqual([one.id, two.id]);
  });

  it("rejects names that are too short or too long", async () => {
    const u = await insertUser(admin);
    await expect(createTenant({ userId: u.id, name: " a " })).rejects.toThrow(/2 and 60/);
    await expect(createTenant({ userId: u.id, name: "x".repeat(61) })).rejects.toThrow(/2 and 60/);
  });
});
