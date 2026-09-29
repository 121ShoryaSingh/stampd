import { describe, it, expect, afterAll } from "vitest";
import { adminDb, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { deleteObject, getObjectBytes, objectExists, putObject } from "@/server/storage/storage";
import { createEnvelope, deleteDraft, finalizeUpload, getEnvelope, uploadKeyFor } from "@/server/envelopes/service";
import { setRecipients } from "@/server/envelopes/recipients";
import { saveFields } from "@/server/envelopes/fields";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { archivePreset, createPreset, getPreset, setPresetRoles } from "./service";
import { createEnvelopeFromPreset, savePresetFromEnvelope } from "./use";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

// A draft with a PDF, two signers in order and a cc, with fields for both signers.
async function draft() {
  const owner = await insertUser(admin);
  const member = await insertUser(admin);
  const { id: tenantId } = await createTenant({ userId: owner.id, name: "Use Co" });
  await admin.membership.create({ data: { tenantId, userId: member.id, role: "member" } });
  const userId = owner.id;
  const { id: envelopeId } = await createEnvelope({ tenantId, userId, title: "Lease" });
  const key = uploadKeyFor(tenantId, envelopeId);
  await putObject(key, await makePdf(2), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId, key, filename: "lease.pdf" });
  const recs = await setRecipients({
    tenantId,
    userId,
    envelopeId,
    recipients: [
      { name: "Tenant", email: "t@x.dev", role: "signer", routingOrder: 1 },
      { name: "Landlord", email: "l@x.dev", role: "signer", routingOrder: 2 },
      { name: "Agent", email: "a@x.dev", role: "cc", routingOrder: 1 },
    ],
  });
  await saveFields({
    tenantId,
    userId,
    envelopeId,
    fields: [
      { recipientId: recs[0].id, type: "signature", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06 },
      { recipientId: recs[0].id, type: "choice", page: 2, x: 0.1, y: 0.3, w: 0.12, h: 0.03 },
      { recipientId: recs[1].id, type: "signature", page: 2, x: 0.5, y: 0.5, w: 0.3, h: 0.06 },
    ],
  });
  return { tenantId, userId, memberId: member.id, envelopeId };
}

const people = (roles: { id: string; label: string }[]) =>
  Object.fromEntries(roles.map((r) => [r.id, { name: `Real ${r.label}`, email: `${r.label.toLowerCase()}@real.dev` }]));

describe("save as preset", () => {
  it("turns a draft into a preset with roles, fields and its own PDF", async () => {
    const d = await draft();
    const { id } = await savePresetFromEnvelope({ ...d, name: "Standard lease" });
    const p = await getPreset(d.tenantId, id);
    expect(p.preset).toMatchObject({ name: "Standard lease", pageCount: 2, filename: "lease.pdf", version: 1 });
    expect(p.roles.map((r) => [r.label, r.role, r.routingOrder, r.defaultEmail])).toEqual([
      ["Tenant", "signer", 1, "t@x.dev"],
      ["Agent", "cc", 1, "a@x.dev"],
      ["Landlord", "signer", 2, "l@x.dev"],
    ]);
    expect(p.fields.map((f) => [p.roles.find((r) => r.id === f.presetRoleId)!.label, f.type, f.page]).sort()).toEqual([
      ["Landlord", "signature", 2],
      ["Tenant", "choice", 2],
      ["Tenant", "signature", 1],
    ]);
    // Deleting the draft must not break the preset.
    const envKey = (await getEnvelope(d.tenantId, d.envelopeId)).document!.s3Key;
    expect(p.preset.s3Key).not.toBe(envKey);
    await deleteDraft({ tenantId: d.tenantId, envelopeId: d.envelopeId });
    expect(await objectExists(p.preset.s3Key!)).toBe(true);
  });

  it("can replace an existing preset, keeping its id and bumping the version", async () => {
    const d = await draft();
    const { id } = await savePresetFromEnvelope({ ...d, name: "Lease" });
    const again = await savePresetFromEnvelope({ ...d, name: "Lease v2", replacePresetId: id });
    expect(again.id).toBe(id);
    const p = await getPreset(d.tenantId, id);
    expect(p.preset).toMatchObject({ name: "Lease v2", version: 2 });
    expect(p.roles).toHaveLength(3);
    expect(p.fields).toHaveLength(3);
  });

  it("only saves drafts", async () => {
    const d = await draft();
    await admin.envelope.update({ where: { id: d.envelopeId }, data: { status: "sent" } });
    await expect(savePresetFromEnvelope({ ...d, name: "Sent one" })).rejects.toThrow(/draft/);
  });

  it("needs an admin, a PDF and recipients", async () => {
    const d = await draft();
    await expect(savePresetFromEnvelope({ ...d, userId: d.memberId, name: "Mine" })).rejects.toThrow(/admins/);
    const { id: empty } = await createEnvelope({ tenantId: d.tenantId, userId: d.userId, title: "Empty" });
    await expect(savePresetFromEnvelope({ ...d, envelopeId: empty, name: "Empty" })).rejects.toThrow(/PDF/);
  });
});

describe("use a preset", () => {
  it("creates a draft with the preset's PDF, people and fields, and counts the use", async () => {
    const d = await draft();
    const { id } = await savePresetFromEnvelope({ ...d, name: "Lease" });
    const { roles } = await getPreset(d.tenantId, id);
    // Members can use presets.
    const { envelopeId } = await createEnvelopeFromPreset({ tenantId: d.tenantId, userId: d.memberId, presetId: id, title: "Lease for Flat 4", people: people(roles) });
    const env = await getEnvelope(d.tenantId, envelopeId);
    expect(env.envelope).toMatchObject({ title: "Lease for Flat 4", status: "draft" });
    expect(env.document).toMatchObject({ filename: "lease.pdf", pageCount: 2 });
    const p = await getPreset(d.tenantId, id);
    expect(env.document!.s3Key).not.toBe(p.preset.s3Key);
    expect(Buffer.from(await getObjectBytes(env.document!.s3Key)).equals(Buffer.from(await getObjectBytes(p.preset.s3Key!)))).toBe(true);
    expect(env.recipients.map((r) => [r.name, r.email, r.role, r.routingOrder]).sort()).toEqual([
      ["Real Agent", "agent@real.dev", "cc", 1],
      ["Real Landlord", "landlord@real.dev", "signer", 2],
      ["Real Tenant", "tenant@real.dev", "signer", 1],
    ]);
    expect(env.fields).toHaveLength(3);
    const byEmail = (email: string) => env.recipients.find((r) => r.email === email)!.id;
    expect(env.fields.filter((f) => f.recipientId === byEmail("tenant@real.dev")).map((f) => f.type).sort()).toEqual(["choice", "signature"]);
    expect(p.preset.usageCount).toBe(1);
    expect(p.preset.lastUsedAt).toBeInstanceOf(Date);
    const events = await withTenant(d.tenantId, (tx) => listAudit(tx, envelopeId));
    expect(events[0]).toMatchObject({ event: "created_from_preset", data: { presetId: id, version: 1, title: "Lease for Flat 4" } });
    // Deleting the new draft leaves the preset intact.
    await deleteDraft({ tenantId: d.tenantId, envelopeId });
    expect(await objectExists(p.preset.s3Key!)).toBe(true);
  });

  it("refuses archived presets, missing people and signer roles without fields", async () => {
    const d = await draft();
    const { id } = await savePresetFromEnvelope({ ...d, name: "Lease" });
    const { roles } = await getPreset(d.tenantId, id);
    const base = { tenantId: d.tenantId, userId: d.userId, presetId: id, title: "X" };
    await expect(createEnvelopeFromPreset({ ...base, people: { [roles[0].id]: { name: "A", email: "a@a.dev" } } })).rejects.toThrow(/Enter a name and email for Agent/);
    await expect(createEnvelopeFromPreset({ ...base, people: { ...people(roles), [roles[0].id]: { name: "A", email: "bad" } } })).rejects.toThrow(/email/);
    // A new signer role with no fields could never be sent.
    await setPresetRoles({ tenantId: d.tenantId, userId: d.userId, presetId: id, roles: [...roles.map((r) => ({ ...r, role: r.role })), { label: "Witness", role: "signer", routingOrder: 3 }] });
    const withWitness = (await getPreset(d.tenantId, id)).roles;
    await expect(createEnvelopeFromPreset({ ...base, people: people(withWitness) })).rejects.toThrow(/Witness has no fields/);
    await archivePreset({ tenantId: d.tenantId, userId: d.userId, presetId: id });
    await expect(createEnvelopeFromPreset({ ...base, people: people(withWitness) })).rejects.toThrow(/archived/);
  });

  it("says the preset changed when its PDF vanished mid-use", async () => {
    const d = await draft();
    const { id } = await savePresetFromEnvelope({ ...d, name: "Lease" });
    const { preset, roles } = await getPreset(d.tenantId, id);
    // Same state as a concurrent PDF replace deleting the old copy.
    await deleteObject(preset.s3Key!);
    await expect(createEnvelopeFromPreset({ tenantId: d.tenantId, userId: d.userId, presetId: id, title: "X", people: people(roles) })).rejects.toThrow(/just changed/);
  });

  it("refuses a preset without a PDF and another workspace's preset", async () => {
    const d = await draft();
    const { id: blank } = await createPreset({ tenantId: d.tenantId, userId: d.userId, name: "Blank" });
    await expect(createEnvelopeFromPreset({ tenantId: d.tenantId, userId: d.userId, presetId: blank, title: "X", people: {} })).rejects.toThrow(/PDF/);
    const other = await draft();
    const { id } = await savePresetFromEnvelope({ ...d, name: "Lease" });
    await expect(createEnvelopeFromPreset({ tenantId: other.tenantId, userId: other.userId, presetId: id, title: "X", people: {} })).rejects.toThrow(/not found/i);
  });
});
