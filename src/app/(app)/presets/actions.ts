"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireTenant } from "@/server/tenants/current";
import { DomainError } from "@/server/errors";
import {
  archivePreset,
  createPreset,
  duplicatePreset,
  finalizePresetUpload,
  presetUploadUrl,
  restorePreset,
  savePresetFields,
  setPresetRoles,
  updatePresetInfo,
} from "@/server/presets/service";
import { createEnvelopeFromPreset, savePresetFromEnvelope } from "@/server/presets/use";

const Id = z.string().uuid();

async function guard<T>(fn: () => Promise<T>): Promise<{ error?: string; data?: T }> {
  try {
    return { data: await fn() };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

// Session, workspace and a checked preset id for every action.
async function actor(presetId: string) {
  const { session, tenant } = await requireTenant();
  return { tenantId: tenant.tenantId, userId: session.user.id, presetId: Id.parse(presetId) };
}

const done = (presetId: string) => {
  revalidatePath(`/presets/${presetId}`);
  revalidatePath("/presets");
};

export async function createPresetAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const { session, tenant } = await requireTenant();
  const p = z.object({ name: z.string().max(500), description: z.string().max(2000).optional() }).safeParse({
    name: form.get("name"),
    description: form.get("description") ?? undefined,
  });
  if (!p.success) return { error: "Enter a name" };
  const res = await guard(() => createPreset({ tenantId: tenant.tenantId, userId: session.user.id, ...p.data }));
  if (res.error) return { error: res.error };
  redirect(`/presets/${res.data!.id}`);
}

export async function updatePresetInfoAction(presetId: string, info: unknown) {
  const a = await actor(presetId);
  const p = z.object({ name: z.string().max(500), description: z.string().max(2000).nullable(), message: z.string().max(4000).nullable() }).safeParse(info);
  if (!p.success) return { error: "Check the preset details" };
  const res = await guard(() => updatePresetInfo({ ...a, ...p.data }));
  done(a.presetId);
  return { error: res.error };
}

export async function presetUploadUrlAction(presetId: string) {
  const a = await actor(presetId);
  const res = await guard(() => presetUploadUrl(a));
  return res.error ? { error: res.error } : res.data!;
}

export async function finalizePresetUploadAction(presetId: string, key: string, filename: string) {
  const a = await actor(presetId);
  const p = z.object({ key: z.string().max(300), filename: z.string().max(300) }).parse({ key, filename });
  const res = await guard(() => finalizePresetUpload({ ...a, ...p }));
  done(a.presetId);
  return { error: res.error };
}

const Role = z.object({
  id: z.string().uuid().optional(),
  label: z.string().max(200),
  role: z.enum(["signer", "cc"]),
  routingOrder: z.number().int(),
  defaultName: z.string().max(200).nullable().optional(),
  defaultEmail: z.string().max(300).nullable().optional(),
});

export async function savePresetRolesAction(presetId: string, list: unknown) {
  const a = await actor(presetId);
  const p = z.array(Role).max(50).safeParse(list);
  if (!p.success) return { error: "Check the role details" };
  const res = await guard(() => setPresetRoles({ ...a, roles: p.data }));
  done(a.presetId);
  return res.error ? { error: res.error } : { saved: res.data };
}

// The shared editor calls the assignee "recipientId"; here it is a role id.
const Field = z.object({
  recipientId: z.string().uuid(),
  type: z.enum(["signature", "initials", "date", "text", "checkbox", "choice"]),
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  required: z.boolean().optional(),
});

export async function savePresetFieldsAction(presetId: string, list: unknown) {
  const a = await actor(presetId);
  const p = z.array(Field).max(500).safeParse(list);
  if (!p.success) return { error: "Some fields are invalid" };
  const res = await guard(() => savePresetFields({ ...a, fields: p.data.map(({ recipientId, ...f }) => ({ ...f, roleId: recipientId })) }));
  done(a.presetId);
  return res.error ? { error: res.error } : { count: res.data };
}

export async function archivePresetAction(form: FormData) {
  const a = await actor(String(form.get("presetId")));
  await guard(() => archivePreset(a));
  done(a.presetId);
}

export async function restorePresetAction(form: FormData) {
  const a = await actor(String(form.get("presetId")));
  await guard(() => restorePreset(a));
  done(a.presetId);
}

export async function duplicatePresetAction(form: FormData) {
  const a = await actor(String(form.get("presetId")));
  const res = await guard(() => duplicatePreset(a));
  revalidatePath("/presets");
  if (res.data) redirect(`/presets/${res.data.id}`);
}

export async function usePresetAction(presetId: string, _prev: { error?: string }, form: FormData): Promise<{ error?: string }> {
  const a = await actor(presetId);
  const title = z.string().max(500).safeParse(form.get("title"));
  if (!title.success) return { error: "Enter a title" };
  // Person inputs are named name:<roleId> and email:<roleId>.
  const people: Record<string, { name: string; email: string }> = {};
  for (const [k, v] of form.entries()) {
    const m = /^(name|email):([0-9a-f-]{36})$/.exec(k);
    if (!m || typeof v !== "string") continue;
    people[m[2]] ??= { name: "", email: "" };
    people[m[2]][m[1] as "name" | "email"] = v.slice(0, 300);
  }
  const res = await guard(() => createEnvelopeFromPreset({ ...a, title: title.data, people }));
  if (res.error) return { error: res.error };
  revalidatePath("/presets");
  redirect(`/envelopes/${res.data!.envelopeId}`);
}

export async function saveAsPresetAction(envelopeId: string, _prev: { error?: string; id?: string }, form: FormData): Promise<{ error?: string; id?: string }> {
  const { session, tenant } = await requireTenant();
  const p = z
    .object({ envelopeId: Id, name: z.string().max(500), replacePresetId: z.union([Id, z.literal("")]).optional() })
    .safeParse({ envelopeId, name: form.get("name"), replacePresetId: form.get("replacePresetId") ?? undefined });
  if (!p.success) return { error: "Enter a name" };
  const res = await guard(() =>
    savePresetFromEnvelope({ tenantId: tenant.tenantId, userId: session.user.id, envelopeId: p.data.envelopeId, name: p.data.name, replacePresetId: p.data.replacePresetId || undefined }),
  );
  if (res.error) return { error: res.error };
  revalidatePath("/presets");
  return { id: res.data!.id };
}
