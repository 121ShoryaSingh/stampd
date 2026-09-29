import { describe, it, expect, afterAll } from "vitest";
import { adminDb, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { getObjectBytes, putObject } from "@/server/storage/storage";
import {
  archivePreset,
  createPreset,
  duplicatePreset,
  finalizePresetUpload,
  getPreset,
  listPresets,
  presetUploadKeyFor,
  restorePreset,
  savePresetFields,
  setPresetRoles,
  updatePresetInfo,
} from "./service";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

// A workspace with an admin and a member.
async function workspace() {
  const owner = await insertUser(admin);
  const member = await insertUser(admin);
  const { id: tenantId } = await createTenant({ userId: owner.id, name: "Preset Co" });
  await admin.membership.create({ data: { tenantId, userId: member.id, role: "member" } });
  return { tenantId, adminId: owner.id, memberId: member.id };
}

async function upload(tenantId: string, userId: string, presetId: string, pages = 2) {
  const key = presetUploadKeyFor(tenantId, presetId);
  await putObject(key, await makePdf(pages), "application/pdf");
  return finalizePresetUpload({ tenantId, userId, presetId, key, filename: "nda.pdf" });
}

// A preset with a PDF, a Client signer and a Manager signer, one signature each.
async function fullPreset() {
  const w = await workspace();
  const { id } = await createPreset({ tenantId: w.tenantId, userId: w.adminId, name: "NDA" });
  await upload(w.tenantId, w.adminId, id);
  const roles = await setPresetRoles({
    tenantId: w.tenantId,
    userId: w.adminId,
    presetId: id,
    roles: [
      { label: "Client", role: "signer", routingOrder: 1 },
      { label: "Manager", role: "signer", routingOrder: 2, defaultName: "Mia Manager", defaultEmail: "Mia@Co.dev" },
    ],
  });
  await savePresetFields({
    tenantId: w.tenantId,
    userId: w.adminId,
    presetId: id,
    fields: roles.map((r, i) => ({ roleId: r.id, type: "signature" as const, page: 1, x: 0.1, y: 0.1 + i * 0.2, w: 0.3, h: 0.06 })),
  });
  return { ...w, presetId: id, roles };
}

describe("presets: create and manage", () => {
  it("builds a preset with a PDF, roles and fields", async () => {
    const p = await fullPreset();
    const got = await getPreset(p.tenantId, p.presetId);
    expect(got.preset).toMatchObject({ name: "NDA", status: "active", pageCount: 2, filename: "nda.pdf" });
    expect(got.preset.s3Key).toMatch(new RegExp(`^t/${p.tenantId}/p/${p.presetId}/doc/`));
    expect(got.roles.map((r) => [r.label, r.routingOrder, r.defaultEmail])).toEqual([
      ["Client", 1, null],
      ["Manager", 2, "mia@co.dev"],
    ]);
    expect(got.fields).toHaveLength(2);
  });

  it("only admins can change presets; members can read them", async () => {
    const p = await fullPreset();
    const m = { tenantId: p.tenantId, userId: p.memberId, presetId: p.presetId };
    await expect(createPreset({ tenantId: p.tenantId, userId: p.memberId, name: "Mine" })).rejects.toThrow(/admins/);
    await expect(updatePresetInfo({ ...m, name: "New" })).rejects.toThrow(/admins/);
    await expect(setPresetRoles({ ...m, roles: [] })).rejects.toThrow(/admins/);
    await expect(savePresetFields({ ...m, fields: [] })).rejects.toThrow(/admins/);
    await expect(archivePreset(m)).rejects.toThrow(/admins/);
    await expect(duplicatePreset(m)).rejects.toThrow(/admins/);
    expect((await listPresets(p.tenantId)).map((r) => r.id)).toContain(p.presetId);
  });

  it("validates names, roles and fields", async () => {
    const p = await fullPreset();
    const a = { tenantId: p.tenantId, userId: p.adminId, presetId: p.presetId };
    await expect(createPreset({ tenantId: p.tenantId, userId: p.adminId, name: " x " })).rejects.toThrow(/2 and 80/);
    await expect(setPresetRoles({ ...a, roles: [{ label: "", role: "signer", routingOrder: 1 }] })).rejects.toThrow(/name/);
    await expect(setPresetRoles({ ...a, roles: [{ label: "A", role: "signer", routingOrder: 0 }] })).rejects.toThrow(/order/);
    await expect(setPresetRoles({ ...a, roles: [{ label: "A", role: "signer", routingOrder: 1 }, { label: "a", role: "cc", routingOrder: 1 }] })).rejects.toThrow(/more than once/);
    await expect(setPresetRoles({ ...a, roles: [{ label: "A", role: "signer", routingOrder: 1, defaultEmail: "nope" }] })).rejects.toThrow(/email/);
    const client = p.roles[0].id;
    await expect(savePresetFields({ ...a, fields: [{ roleId: client, type: "signature", page: 3, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] })).rejects.toThrow(/no page 3/);
    await expect(savePresetFields({ ...a, fields: [{ roleId: client, type: "signature", page: 1, x: 0.9, y: 0.1, w: 0.2, h: 0.05 }] })).rejects.toThrow(/outside/);
    await expect(savePresetFields({ ...a, fields: [{ roleId: "00000000-0000-7000-8000-000000000000", type: "text", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] })).rejects.toThrow(/role/);
    // A cc role never signs, so it cannot hold fields.
    const [, cc] = await setPresetRoles({ ...a, roles: [{ id: client, label: "Client", role: "signer", routingOrder: 1 }, { label: "Copy", role: "cc", routingOrder: 1 }] });
    await expect(savePresetFields({ ...a, fields: [{ roleId: cc.id, type: "text", page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] })).rejects.toThrow(/cc/);
  });

  it("keeps fields of kept roles and drops fields of removed ones", async () => {
    const p = await fullPreset();
    await setPresetRoles({ tenantId: p.tenantId, userId: p.adminId, presetId: p.presetId, roles: [{ id: p.roles[0].id, label: "Customer", role: "signer", routingOrder: 1 }] });
    const got = await getPreset(p.tenantId, p.presetId);
    expect(got.roles.map((r) => r.label)).toEqual(["Customer"]);
    expect(got.fields.map((f) => f.presetRoleId)).toEqual([p.roles[0].id]);
  });

  it("bumps the version for roles and fields, not for name changes", async () => {
    const p = await fullPreset();
    const a = { tenantId: p.tenantId, userId: p.adminId, presetId: p.presetId };
    const v = (await getPreset(p.tenantId, p.presetId)).preset.version;
    await updatePresetInfo({ ...a, name: "Mutual NDA", description: "Both sides" });
    expect((await getPreset(p.tenantId, p.presetId)).preset).toMatchObject({ name: "Mutual NDA", description: "Both sides", version: v });
    // Two saves at once both land: the row lock serializes them.
    const roles = p.roles.map((r) => ({ id: r.id, label: r.label, role: "signer" as const, routingOrder: 1 }));
    await Promise.all([setPresetRoles({ ...a, roles }), setPresetRoles({ ...a, roles })]);
    expect((await getPreset(p.tenantId, p.presetId)).preset.version).toBe(v + 2);
  });

  it("a new PDF with fewer pages drops fields on missing pages", async () => {
    const p = await fullPreset();
    const a = { tenantId: p.tenantId, userId: p.adminId, presetId: p.presetId };
    await savePresetFields({
      ...a,
      fields: [
        { roleId: p.roles[0].id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 },
        { roleId: p.roles[1].id, type: "signature", page: 2, x: 0.1, y: 0.1, w: 0.3, h: 0.06 },
      ],
    });
    const old = (await getPreset(p.tenantId, p.presetId)).preset;
    await upload(p.tenantId, p.adminId, p.presetId, 1);
    const got = await getPreset(p.tenantId, p.presetId);
    expect(got.preset.pageCount).toBe(1);
    expect(got.fields.map((f) => f.page)).toEqual([1]);
    expect(got.preset.version).toBe(old.version + 1);
  });

  it("replacing the PDF always bumps the version", async () => {
    const p = await fullPreset();
    const v = (await getPreset(p.tenantId, p.presetId)).preset.version;
    await upload(p.tenantId, p.adminId, p.presetId, 2);
    const got = await getPreset(p.tenantId, p.presetId);
    expect(got.fields).toHaveLength(2);
    expect(got.preset.version).toBe(v + 1);
  });

  it("duplicates into an independent preset", async () => {
    const p = await fullPreset();
    await admin.preset.update({ where: { id: p.presetId }, data: { usageCount: 7 } });
    const { id } = await duplicatePreset({ tenantId: p.tenantId, userId: p.adminId, presetId: p.presetId });
    const [src, copy] = [await getPreset(p.tenantId, p.presetId), await getPreset(p.tenantId, id)];
    expect(copy.preset).toMatchObject({ name: "NDA (copy)", version: 1, usageCount: 0, pageCount: 2 });
    expect(copy.preset.s3Key).not.toBe(src.preset.s3Key);
    expect(Buffer.from(await getObjectBytes(copy.preset.s3Key!)).equals(Buffer.from(await getObjectBytes(src.preset.s3Key!)))).toBe(true);
    expect(copy.roles.map((r) => r.label)).toEqual(["Client", "Manager"]);
    expect(copy.fields).toHaveLength(2);
    expect(copy.fields.every((f) => copy.roles.some((r) => r.id === f.presetRoleId))).toBe(true);
  });

  it("archives and restores; lists sort by usage then name and can search", async () => {
    const p = await fullPreset();
    const a = { tenantId: p.tenantId, userId: p.adminId };
    const { id: other } = await createPreset({ ...a, name: "Addendum" });
    const { id: busy } = await createPreset({ ...a, name: "Zeta lease" });
    await admin.preset.update({ where: { id: busy }, data: { usageCount: 3 } });
    expect((await listPresets(p.tenantId)).map((r) => r.id)).toEqual([busy, other, p.presetId]);
    expect((await listPresets(p.tenantId, { q: "lease" })).map((r) => r.id)).toEqual([busy]);
    await archivePreset({ ...a, presetId: other });
    expect((await listPresets(p.tenantId)).map((r) => r.id)).not.toContain(other);
    expect((await listPresets(p.tenantId, { status: "archived" })).map((r) => r.id)).toEqual([other]);
    await restorePreset({ ...a, presetId: other });
    expect((await listPresets(p.tenantId)).map((r) => r.id)).toContain(other);
    const row = (await listPresets(p.tenantId)).find((r) => r.id === p.presetId)!;
    expect(row).toMatchObject({ roles: ["Client", "Manager"], pageCount: 2 });
  });

  it("another workspace's preset is not found", async () => {
    const p = await fullPreset();
    const other = await workspace();
    await expect(getPreset(other.tenantId, p.presetId)).rejects.toThrow(/not found/i);
    await expect(archivePreset({ tenantId: other.tenantId, userId: other.adminId, presetId: p.presetId })).rejects.toThrow(/not found/i);
  });
});
