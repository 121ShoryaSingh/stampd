import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../helpers/db";
import { withDb, withTenant } from "@/server/db/context";

const admin = adminDb();
let a: string, b: string, presetB: string, userId: string;

beforeAll(async () => {
  const u = await insertUser(admin);
  userId = u.id;
  [a, b] = [await insertTenant(admin, "PresetA"), await insertTenant(admin, "PresetB")];
  for (const t of [a, b]) {
    const p = await admin.preset.create({ data: { tenantId: t, name: `Preset ${t}`, createdBy: u.id } });
    const r = await admin.presetRole.create({ data: { tenantId: t, presetId: p.id, label: "Client", role: "signer", routingOrder: 1, position: 0 } });
    await admin.presetField.create({ data: { tenantId: t, presetId: p.id, presetRoleId: r.id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 } });
    if (t === b) presetB = p.id;
  }
});
afterAll(async () => {
  await admin.$disconnect();
});

describe("preset isolation", () => {
  it("a workspace sees only its own presets, roles and fields", async () => {
    const [p, r, f] = await withTenant(a, async (tx) => [await tx.preset.findMany(), await tx.presetRole.findMany(), await tx.presetField.findMany()]);
    for (const rows of [p, r, f]) {
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(a);
    }
  });

  it("cannot change or create presets of another workspace", async () => {
    const res = await withTenant(a, (tx) => tx.preset.updateMany({ where: { id: presetB }, data: { name: "Hijacked" } }));
    expect(res.count).toBe(0);
    await expect(withTenant(a, (tx) => tx.preset.create({ data: { tenantId: b, name: "Sneaky", createdBy: userId } }))).rejects.toThrow(/row-level security/);
  });

  it("sees nothing without a workspace", async () => {
    expect(await withDb({}, (tx) => tx.preset.findMany())).toHaveLength(0);
  });
});
