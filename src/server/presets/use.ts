import "server-only";
import { uuidv7 } from "uuidv7";
import { withTenant } from "@/server/db/context";
import { appendAudit } from "@/server/audit/service";
import { deleteObject, getObjectBytes, putObject } from "@/server/storage/storage";
import { InvalidStateError, NotFoundError, ValidationError } from "@/server/errors";
import { assertAdmin } from "@/server/team/service";
import { normalizeEmail } from "@/server/team/email";
import { cleanTitle } from "@/server/envelopes/service";
import { documentKeyFor } from "@/server/envelopes/keys";
import { lockPreset, presetDocKeyFor } from "./service";

export type Person = { name: string; email: string };

// Saves a draft as a new preset, or over an existing one (version bump).
export async function savePresetFromEnvelope(i: { tenantId: string; userId: string; envelopeId: string; name: string; replacePresetId?: string }) {
  const name = i.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw new ValidationError("Preset name must be between 2 and 80 characters");
  const env = await withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.tenantId, i.userId);
    const e = await tx.envelope.findUnique({ where: { id: i.envelopeId }, include: { document: true, recipients: true, fields: true } });
    if (!e) throw new NotFoundError("Envelope not found");
    return e;
  });
  if (!env.document) throw new ValidationError("Upload a PDF before saving a preset");
  if (env.recipients.length === 0) throw new ValidationError("Add recipients before saving a preset");

  const presetId = i.replacePresetId ?? uuidv7();
  const docKey = presetDocKeyFor(i.tenantId, presetId);
  await putObject(docKey, await getObjectBytes(env.document.s3Key), "application/pdf");
  const doc = env.document;
  const docData = { filename: doc.filename, s3Key: docKey, sha256: doc.sha256, pageCount: doc.pageCount, pageSizes: doc.pageSizes ?? [], sizeBytes: doc.sizeBytes };
  // Stable role order: signing step, signers before cc, then creation order.
  const recipients = [...env.recipients].sort((a, b) => a.routingOrder - b.routingOrder || (a.role === b.role ? 0 : a.role === "signer" ? -1 : 1) || a.id.localeCompare(b.id));

  const oldKey = await withTenant(i.tenantId, async (tx) => {
    let old: string | null = null;
    if (i.replacePresetId) {
      await assertAdmin(tx, i.tenantId, i.userId);
      const p = await lockPreset(tx, presetId, true);
      old = p.s3Key;
      await tx.presetRole.deleteMany({ where: { presetId } }); // fields cascade
      await tx.preset.update({ where: { id: presetId }, data: { name, message: env.message, ...docData } });
    } else {
      await tx.preset.create({ data: { id: presetId, tenantId: i.tenantId, createdBy: i.userId, name, message: env.message, ...docData } });
    }
    const roleOf = new Map<string, string>();
    const labels = new Set<string>();
    for (const [position, r] of recipients.entries()) {
      // Labels must be unique; two recipients with one name get a number.
      let label = r.name.slice(0, 76);
      for (let n = 2; labels.has(label.toLowerCase()); n++) label = `${r.name.slice(0, 76)} ${n}`;
      labels.add(label.toLowerCase());
      const role = await tx.presetRole.create({
        data: { tenantId: i.tenantId, presetId, label, role: r.role, routingOrder: r.routingOrder, defaultName: r.name, defaultEmail: r.email, position },
      });
      roleOf.set(r.id, role.id);
    }
    const fields = env.fields.filter((f) => roleOf.has(f.recipientId));
    if (fields.length) {
      await tx.presetField.createMany({
        data: fields.map((f) => ({ tenantId: i.tenantId, presetId, presetRoleId: roleOf.get(f.recipientId)!, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required })),
      });
    }
    return old;
  }).catch(async (e) => {
    await deleteObject(docKey);
    throw e;
  });
  if (oldKey) await deleteObject(oldKey);
  return { id: presetId };
}

// Starts a normal draft from a preset: its own PDF copy, recipients and fields.
export async function createEnvelopeFromPreset(i: { tenantId: string; userId: string; presetId: string; title: string; people: Record<string, Person> }) {
  const title = cleanTitle(i.title);
  const preset = await withTenant(i.tenantId, (tx) => tx.preset.findUnique({ where: { id: i.presetId }, include: { roles: { orderBy: { position: "asc" } }, fields: true } }));
  if (!preset) throw new NotFoundError("Preset not found");
  if (preset.status === "archived") throw new InvalidStateError("This preset is archived. Restore it to use it.");
  if (!preset.s3Key) throw new ValidationError("This preset has no PDF yet");
  if (preset.roles.length === 0) throw new ValidationError("This preset has no roles yet");

  const seen = new Set<string>();
  const people = preset.roles.map((role) => {
    const p = i.people[role.id];
    const name = p?.name?.trim().replace(/\s+/g, " ") ?? "";
    if (!p || name.length < 1 || name.length > 120 || !p.email?.trim()) throw new ValidationError(`Enter a name and email for ${role.label}`);
    const email = normalizeEmail(p.email);
    if (seen.has(email)) throw new ValidationError(`${email} is listed more than once`);
    seen.add(email);
    if (role.role === "signer" && !preset.fields.some((f) => f.presetRoleId === role.id)) {
      throw new ValidationError(`${role.label} has no fields. Edit the preset to add some.`);
    }
    return { role, name, email };
  });

  const envelopeId = uuidv7();
  const docKey = documentKeyFor(i.tenantId, envelopeId);
  await putObject(docKey, await getObjectBytes(preset.s3Key), "application/pdf");
  return withTenant(i.tenantId, async (tx) => {
    await tx.envelope.create({ data: { id: envelopeId, tenantId: i.tenantId, createdBy: i.userId, title, message: preset.message } });
    const doc = await tx.document.create({
      data: {
        tenantId: i.tenantId,
        envelopeId,
        filename: preset.filename ?? "document.pdf",
        s3Key: docKey,
        sha256: preset.sha256!,
        pageCount: preset.pageCount,
        pageSizes: preset.pageSizes ?? [],
        sizeBytes: preset.sizeBytes,
      },
    });
    const recipientOf = new Map<string, string>();
    for (const p of people) {
      const r = await tx.recipient.create({ data: { tenantId: i.tenantId, envelopeId, name: p.name, email: p.email, role: p.role.role, routingOrder: p.role.routingOrder } });
      recipientOf.set(p.role.id, r.id);
    }
    const fields = preset.fields.filter((f) => recipientOf.has(f.presetRoleId) && preset.roles.find((r) => r.id === f.presetRoleId)!.role === "signer");
    if (fields.length) {
      await tx.field.createMany({
        data: fields.map((f) => ({ tenantId: i.tenantId, envelopeId, documentId: doc.id, recipientId: recipientOf.get(f.presetRoleId)!, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required })),
      });
    }
    // Usage ranks presets in the list.
    await tx.preset.update({ where: { id: preset.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
    await appendAudit(tx, {
      tenantId: i.tenantId,
      envelopeId,
      actorType: "user",
      actorId: i.userId,
      event: "created_from_preset",
      data: { title, presetId: preset.id, presetName: preset.name, version: preset.version },
    });
    return { envelopeId };
  }).catch(async (e) => {
    await deleteObject(docKey);
    throw e;
  });
}
