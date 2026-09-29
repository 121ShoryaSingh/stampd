import "server-only";
import { randomUUID } from "node:crypto";
import { withTenant, type Tx } from "@/server/db/context";
import type { FieldType, PageSize } from "@/server/db/types";
import { deleteObject, getObjectBytes, presignUpload, putObject } from "@/server/storage/storage";
import { NotFoundError, ValidationError } from "@/server/errors";
import { assertAdmin } from "@/server/team/service";
import { normalizeEmail } from "@/server/team/email";
import { readUploadedPdf } from "@/server/envelopes/service";
import { checkFieldPlacement, MAX_FIELDS } from "@/server/envelopes/fields";
import { MAX_RECIPIENTS } from "@/server/envelopes/recipients";

export type PresetRoleInput = { id?: string; label: string; role: "signer" | "cc"; routingOrder: number; defaultName?: string | null; defaultEmail?: string | null };
export type PresetFieldInput = { roleId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required?: boolean };
type Actor = { tenantId: string; userId: string; presetId: string };

const UPLOAD_RE = /^t\/([0-9a-f-]{36})\/p\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.pdf$/;

export function presetUploadKeyFor(tenantId: string, presetId: string) {
  return `t/${tenantId}/p/${presetId}/${randomUUID()}.pdf`;
}

// Verified preset PDFs live here; never handed out for upload.
export function presetDocKeyFor(tenantId: string, presetId: string) {
  return `t/${tenantId}/p/${presetId}/doc/${randomUUID()}.pdf`;
}

function cleanName(raw: string) {
  const n = raw.trim().replace(/\s+/g, " ");
  if (n.length < 2 || n.length > 80) throw new ValidationError("Preset name must be between 2 and 80 characters");
  return n;
}

const cleanDescription = (raw?: string | null) => raw?.trim().slice(0, 500) || null;

// Touching the row locks it, so concurrent edits of one preset run one at a time.
export async function lockPreset(tx: Tx, presetId: string, bump = false) {
  const res = await tx.preset.updateMany({ where: { id: presetId }, data: { updatedAt: new Date(), ...(bump ? { version: { increment: 1 } } : {}) } });
  if (res.count === 0) throw new NotFoundError("Preset not found");
  return tx.preset.findUniqueOrThrow({ where: { id: presetId } });
}

async function adminLock(tx: Tx, a: Actor, bump = false) {
  await assertAdmin(tx, a.tenantId, a.userId);
  return lockPreset(tx, a.presetId, bump);
}

export async function createPreset(i: { tenantId: string; userId: string; name: string; description?: string | null }) {
  const name = cleanName(i.name);
  return withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.tenantId, i.userId);
    const p = await tx.preset.create({ data: { tenantId: i.tenantId, createdBy: i.userId, name, description: cleanDescription(i.description) } });
    return { id: p.id };
  });
}

export async function updatePresetInfo(i: Actor & { name: string; description?: string | null; message?: string | null }) {
  const name = cleanName(i.name);
  await withTenant(i.tenantId, async (tx) => {
    await adminLock(tx, i);
    await tx.preset.update({ where: { id: i.presetId }, data: { name, description: cleanDescription(i.description), message: i.message?.trim().slice(0, 2000) || null } });
  });
}

export async function presetUploadUrl(i: Actor) {
  await withTenant(i.tenantId, (tx) => adminLock(tx, i));
  const key = presetUploadKeyFor(i.tenantId, i.presetId);
  return { key, url: await presignUpload(key, "application/pdf") };
}

export async function finalizePresetUpload(i: Actor & { key: string; filename: string }) {
  const m = UPLOAD_RE.exec(i.key);
  if (!m || m[1] !== i.tenantId || m[2] !== i.presetId) throw new ValidationError("This upload does not belong to this preset");
  await withTenant(i.tenantId, (tx) => adminLock(tx, i));
  const { bytes, info, sha256, filename } = await readUploadedPdf(i.key, i.filename);
  const docKey = presetDocKeyFor(i.tenantId, i.presetId);
  await putObject(docKey, bytes, "application/pdf");
  await deleteObject(i.key);
  const oldKey = await withTenant(i.tenantId, async (tx) => {
    const old = await adminLock(tx, i);
    // Fields on pages the new PDF lacks are dropped; that changes the preset.
    const dropped = await tx.presetField.deleteMany({ where: { presetId: i.presetId, page: { gt: info.pageCount } } });
    await tx.preset.update({
      where: { id: i.presetId },
      data: { filename, s3Key: docKey, sha256, pageCount: info.pageCount, pageSizes: info.pageSizes, sizeBytes: bytes.byteLength, ...(dropped.count ? { version: { increment: 1 } } : {}) },
    });
    return old.s3Key;
  }).catch(async (e) => {
    await deleteObject(docKey);
    throw e;
  });
  if (oldKey) await deleteObject(oldKey);
  return { pageCount: info.pageCount };
}

function cleanRoles(list: PresetRoleInput[]) {
  if (list.length > MAX_RECIPIENTS) throw new ValidationError(`A preset can have at most ${MAX_RECIPIENTS} roles`);
  const seen = new Set<string>();
  return list.map((r, position) => {
    const label = r.label.trim().replace(/\s+/g, " ");
    if (label.length < 1 || label.length > 80) throw new ValidationError("Every role needs a name");
    if (seen.has(label.toLowerCase())) throw new ValidationError(`${label} is listed more than once`);
    seen.add(label.toLowerCase());
    if (!Number.isInteger(r.routingOrder) || r.routingOrder < 1 || r.routingOrder > MAX_RECIPIENTS) {
      throw new ValidationError("Signing order must be a number from 1 to 20");
    }
    if (r.role !== "signer" && r.role !== "cc") throw new ValidationError("Role must be signer or cc");
    const defaultName = r.defaultName?.trim().replace(/\s+/g, " ").slice(0, 120) || null;
    const defaultEmail = r.defaultEmail?.trim() ? normalizeEmail(r.defaultEmail) : null;
    return { id: r.id, label, role: r.role, routingOrder: r.routingOrder, defaultName, defaultEmail, position };
  });
}

// Replaces the role list; roles kept by id keep their fields.
export async function setPresetRoles(i: Actor & { roles: PresetRoleInput[] }) {
  return withTenant(i.tenantId, async (tx) => {
    await adminLock(tx, i, true);
    const list = cleanRoles(i.roles);
    const existing = new Set((await tx.presetRole.findMany({ where: { presetId: i.presetId }, select: { id: true } })).map((r) => r.id));
    const keep = list.filter((r) => r.id && existing.has(r.id)).map((r) => r.id!);
    await tx.presetRole.deleteMany({ where: { presetId: i.presetId, id: { notIn: keep } } });
    const out: { id: string; label: string }[] = [];
    for (const { id, ...r } of list) {
      const row =
        id && existing.has(id)
          ? await tx.presetRole.update({ where: { id }, data: r, select: { id: true, label: true } })
          : await tx.presetRole.create({ data: { ...r, tenantId: i.tenantId, presetId: i.presetId }, select: { id: true, label: true } });
      out.push(row);
    }
    // A cc role never signs, so it cannot keep fields.
    await tx.presetField.deleteMany({ where: { presetId: i.presetId, role: { role: "cc" } } });
    return out;
  });
}

export async function savePresetFields(i: Actor & { fields: PresetFieldInput[] }) {
  if (i.fields.length > MAX_FIELDS) throw new ValidationError(`At most ${MAX_FIELDS} fields per preset`);
  return withTenant(i.tenantId, async (tx) => {
    const preset = await adminLock(tx, i, true);
    if (!preset.s3Key) throw new ValidationError("Upload a PDF before placing fields");
    const roles = new Map((await tx.presetRole.findMany({ where: { presetId: i.presetId } })).map((r) => [r.id, r]));
    const rows = i.fields.map((f) => {
      checkFieldPlacement(f, preset.pageCount);
      const role = roles.get(f.roleId);
      if (!role) throw new ValidationError("A field is assigned to a role that is not on this preset");
      if (role.role === "cc") throw new ValidationError(`${role.label} is cc only and cannot have fields`);
      return { tenantId: i.tenantId, presetId: i.presetId, presetRoleId: f.roleId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required ?? f.type !== "checkbox" };
    });
    await tx.presetField.deleteMany({ where: { presetId: i.presetId } });
    if (rows.length) await tx.presetField.createMany({ data: rows });
    return rows.length;
  });
}

export async function archivePreset(i: Actor) {
  await withTenant(i.tenantId, async (tx) => {
    await adminLock(tx, i);
    await tx.preset.update({ where: { id: i.presetId }, data: { status: "archived" } });
  });
}

export async function restorePreset(i: Actor) {
  await withTenant(i.tenantId, async (tx) => {
    await adminLock(tx, i);
    await tx.preset.update({ where: { id: i.presetId }, data: { status: "active" } });
  });
}

// Copies PDF, roles and fields into a fresh preset.
export async function duplicatePreset(i: Actor) {
  const src = await withTenant(i.tenantId, async (tx) => {
    await adminLock(tx, i);
    return tx.preset.findUniqueOrThrow({ where: { id: i.presetId }, include: { roles: true, fields: true } });
  });
  const id = randomUUID();
  const docKey = src.s3Key ? presetDocKeyFor(i.tenantId, id) : null;
  if (src.s3Key && docKey) await putObject(docKey, await getObjectBytes(src.s3Key), "application/pdf");
  return withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.tenantId, i.userId);
    await tx.preset.create({
      data: {
        id,
        tenantId: i.tenantId,
        createdBy: i.userId,
        name: `${src.name.slice(0, 73)} (copy)`,
        description: src.description,
        message: src.message,
        filename: src.filename,
        s3Key: docKey,
        sha256: src.sha256,
        pageCount: src.pageCount,
        pageSizes: src.pageSizes ?? [],
        sizeBytes: src.sizeBytes,
      },
    });
    const roleIds = new Map<string, string>();
    for (const r of src.roles) {
      const row = await tx.presetRole.create({
        data: { tenantId: i.tenantId, presetId: id, label: r.label, role: r.role, routingOrder: r.routingOrder, defaultName: r.defaultName, defaultEmail: r.defaultEmail, position: r.position },
      });
      roleIds.set(r.id, row.id);
    }
    if (src.fields.length) {
      await tx.presetField.createMany({
        data: src.fields.map((f) => ({ tenantId: i.tenantId, presetId: id, presetRoleId: roleIds.get(f.presetRoleId)!, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required })),
      });
    }
    return { id };
  }).catch(async (e) => {
    if (docKey) await deleteObject(docKey);
    throw e;
  });
}

export async function listPresets(tenantId: string, filter: { status?: "active" | "archived"; q?: string } = {}) {
  const q = filter.q?.trim().slice(0, 100);
  const rows = await withTenant(tenantId, (tx) =>
    tx.preset.findMany({
      where: { status: filter.status ?? "active", ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
      include: { roles: { select: { label: true }, orderBy: { position: "asc" } }, _count: { select: { fields: true } } },
      orderBy: [{ usageCount: "desc" }, { name: "asc" }],
      take: 200,
    }),
  );
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    version: p.version,
    usageCount: p.usageCount,
    lastUsedAt: p.lastUsedAt,
    pageCount: p.pageCount,
    hasDocument: !!p.s3Key,
    fieldCount: p._count.fields,
    roles: p.roles.map((r) => r.label),
    updatedAt: p.updatedAt,
  }));
}

export async function getPreset(tenantId: string, presetId: string) {
  const p = await withTenant(tenantId, (tx) =>
    tx.preset.findUnique({ where: { id: presetId }, include: { roles: { orderBy: { position: "asc" } }, fields: { orderBy: { id: "asc" } } } }),
  );
  if (!p) throw new NotFoundError("Preset not found");
  const { roles, fields, ...preset } = p;
  return { preset: { ...preset, pageSizes: preset.pageSizes as PageSize[] }, roles, fields };
}
