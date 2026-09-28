import "server-only";
import { randomUUID } from "node:crypto";
import type { Tx } from "@/server/db/context";
import { appendAudit } from "@/server/audit/service";
import { lockEnvelope } from "@/server/envelopes/service";
import { deleteObject, putObject } from "@/server/storage/storage";
import { InvalidStateError, ValidationError } from "@/server/errors";
import { inTenant, signerState, type ReqMeta, type SignerRef } from "./access";
import { requireSignerSession } from "./service";
import { decodePng } from "./png";

export type SubmitInput = { values: Record<string, string>; signaturePng?: string; initialsPng?: string };

const MAX_TEXT = 500;
const today = () => new Date().toISOString().slice(0, 10);

function event(ref: SignerRef, name: string, meta: ReqMeta, data: Record<string, unknown> = {}) {
  return { tenantId: ref.tenantId, envelopeId: ref.envelopeId, actorType: "recipient" as const, actorId: ref.recipientId, event: name, ip: meta.ip, userAgent: meta.userAgent, data };
}

// Locks the envelope (serializing all signers of it) and checks it is still open.
async function lockOpen(tx: Tx, ref: SignerRef) {
  const env = await lockEnvelope(tx, ref.envelopeId);
  const rec = await tx.recipient.findUniqueOrThrow({ where: { id: ref.recipientId } });
  const state = signerState(env, rec);
  if (state === "signed") throw new InvalidStateError("You have already signed this envelope");
  if (state !== "ready") throw new InvalidStateError("This envelope is closed");
}

// Starts the next routing step, or completes the envelope when every signer has signed.
async function advanceRouting(tx: Tx, ref: SignerRef, meta: ReqMeta) {
  const signers = await tx.recipient.findMany({ where: { envelopeId: ref.envelopeId, role: "signer" } });
  const open = signers.filter((s) => s.status !== "signed");
  if (open.length === 0) {
    await tx.envelope.update({ where: { id: ref.envelopeId }, data: { status: "completed", completedAt: new Date() } });
    await appendAudit(tx, { ...event(ref, "completed", meta), actorType: "system", actorId: null });
    return { envelopeStatus: "completed" as const, nextStepStarted: false };
  }
  const step = Math.min(...open.map((s) => s.routingOrder));
  const toStart = open.filter((s) => s.routingOrder === step && s.status === "pending");
  if (toStart.length > 0 && toStart.length === open.filter((s) => s.routingOrder === step).length) {
    await tx.recipient.updateMany({ where: { id: { in: toStart.map((s) => s.id) } }, data: { status: "sent" } });
    await appendAudit(tx, { ...event(ref, "step_started", meta, { step, recipients: toStart.map((s) => s.email) }), actorType: "system", actorId: null });
    return { envelopeStatus: "sent" as const, nextStepStarted: true };
  }
  return { envelopeStatus: "sent" as const, nextStepStarted: false };
}

export async function submitSigning(token: string, session: string | undefined, input: SubmitInput, meta: ReqMeta) {
  const { ref, rec } = await requireSignerSession(token, session);
  const fields = await inTenant(ref, (tx) => tx.field.findMany({ where: { recipientId: ref.recipientId } }));
  const mine = new Set(fields.map((f) => f.id));
  for (const id of Object.keys(input.values)) {
    if (!mine.has(id)) throw new ValidationError("A value was sent for a field that is not yours");
  }

  // Validate everything before touching storage.
  const needs = (t: string) => fields.some((f) => f.type === t);
  if (needs("signature") && !input.signaturePng) throw new ValidationError("Please adopt your signature");
  if (needs("initials") && !input.initialsPng) throw new ValidationError("Please adopt your initials");
  const images: Record<string, Uint8Array> = {};
  if (needs("signature")) images.signature = decodePng(input.signaturePng!);
  if (needs("initials")) images.initials = decodePng(input.initialsPng!);
  const values = new Map<string, string | null>();
  for (const f of fields) {
    const raw = input.values[f.id];
    if (f.type === "date") values.set(f.id, today());
    else if (f.type === "text") {
      const v = (raw ?? "").trim();
      if (v.length > MAX_TEXT) throw new ValidationError(`Text fields can have at most ${MAX_TEXT} characters`);
      if (f.required && !v) throw new ValidationError("Please fill in every required field");
      values.set(f.id, v || null);
    } else if (f.type === "checkbox") {
      const v = raw === "true" ? "true" : "false";
      if (f.required && v !== "true") throw new ValidationError("Please tick every required checkbox");
      values.set(f.id, v);
    }
  }

  const keys: Record<string, string> = {};
  for (const [kind, bytes] of Object.entries(images)) {
    keys[kind] = `t/${ref.tenantId}/e/${ref.envelopeId}/sig/${rec.id}/${randomUUID()}.png`;
    await putObject(keys[kind], bytes, "image/png");
  }

  try {
    return await inTenant(ref, async (tx) => {
      await lockOpen(tx, ref);
      const claimed = await tx.recipient.updateMany({
        where: { id: rec.id, status: { in: ["sent", "viewed"] } },
        data: { status: "signed", signedAt: new Date(), signIp: meta.ip, signUserAgent: meta.userAgent },
      });
      if (claimed.count === 0) throw new InvalidStateError("You have already signed this envelope");
      for (const f of fields) {
        const img = f.type === "signature" ? keys.signature : f.type === "initials" ? keys.initials : undefined;
        await tx.field.update({ where: { id: f.id }, data: img ? { signatureS3Key: img } : { value: values.get(f.id) ?? null } });
      }
      await appendAudit(tx, event(ref, "signed", meta, { fields: fields.length }));
      return advanceRouting(tx, ref, meta);
    });
  } catch (e) {
    await Promise.all(Object.values(keys).map((k) => deleteObject(k)));
    throw e;
  }
}

export async function declineSigning(token: string, session: string | undefined, reason: string, meta: ReqMeta) {
  const why = reason.trim().slice(0, 500);
  if (!why) throw new ValidationError("Please give a reason for declining");
  const { ref } = await requireSignerSession(token, session);
  await inTenant(ref, async (tx) => {
    await lockOpen(tx, ref);
    const claimed = await tx.recipient.updateMany({
      where: { id: ref.recipientId, status: { in: ["sent", "viewed"] } },
      data: { status: "declined", declinedAt: new Date(), declineReason: why },
    });
    if (claimed.count === 0) throw new InvalidStateError("This envelope is closed");
    await tx.envelope.update({ where: { id: ref.envelopeId }, data: { status: "declined" } });
    await appendAudit(tx, event(ref, "declined", meta, { reason: why }));
  });
}
