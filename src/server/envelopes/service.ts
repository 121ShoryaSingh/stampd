import "server-only";
import { createHash } from "node:crypto";
import { withTenant, type Tx } from "@/server/db/context";
import type { EnvelopeStatus, PageSize } from "@/server/db/types";
import { appendAudit } from "@/server/audit/service";
import { deleteObject, getObjectBytes, objectSize, presignUpload, putObject } from "@/server/storage/storage";
import { InvalidStateError, NotFoundError, ValidationError } from "@/server/errors";
import { inspectPdf } from "./pdf";
import { documentKeyFor, isUploadKeyFor, uploadKeyFor } from "./keys";
import { issueLink, senderOf } from "./links";
import { enqueueEmail } from "@/server/email/outbox";

export { uploadKeyFor } from "./keys";
export const MAX_UPLOAD_BYTES = 26_214_400;

// Touching the row locks it until the transaction ends; a concurrent caller waits here.
export async function lockEnvelope(tx: Tx, envelopeId: string) {
  const res = await tx.envelope.updateMany({ where: { id: envelopeId }, data: { updatedAt: new Date() } });
  if (res.count === 0) throw new NotFoundError("Envelope not found");
  return tx.envelope.findUniqueOrThrow({ where: { id: envelopeId } });
}

export async function lockDraft(tx: Tx, envelopeId: string) {
  const env = await lockEnvelope(tx, envelopeId);
  if (env.status !== "draft") throw new InvalidStateError("This envelope was already sent and can no longer be edited");
  return env;
}

function cleanTitle(raw: string) {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t.length < 1 || t.length > 200) throw new ValidationError("Title must be between 1 and 200 characters");
  return t;
}

export async function createEnvelope(i: { tenantId: string; userId: string; title: string }) {
  const title = cleanTitle(i.title);
  return withTenant(i.tenantId, async (tx) => {
    const env = await tx.envelope.create({ data: { tenantId: i.tenantId, createdBy: i.userId, title } });
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: env.id, actorType: "user", actorId: i.userId, event: "created", data: { title } });
    return { id: env.id };
  });
}

export async function createUploadUrl(i: { tenantId: string; envelopeId: string }) {
  await withTenant(i.tenantId, (tx) => lockDraft(tx, i.envelopeId));
  const key = uploadKeyFor(i.tenantId, i.envelopeId);
  return { url: await presignUpload(key, "application/pdf"), key };
}

// Checks an uploaded PDF (size, structure) and deletes the upload if it is rejected.
export async function readUploadedPdf(key: string, rawFilename: string) {
  const size = await objectSize(key);
  if (size === null) throw new ValidationError("The upload did not finish. Please try again.");
  // A signed PUT cannot enforce limits, so check size before downloading and clean up on rejection.
  if (size > MAX_UPLOAD_BYTES) {
    await deleteObject(key);
    throw new ValidationError("PDFs can be at most 25 MB");
  }
  const bytes = await getObjectBytes(key);
  let info: { pageCount: number; pageSizes: PageSize[] };
  try {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ValidationError("PDFs can be at most 25 MB");
    info = await inspectPdf(bytes);
  } catch (e) {
    await deleteObject(key);
    throw e;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = rawFilename.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "document.pdf";
  return { bytes, info, sha256, filename };
}

export async function finalizeUpload(i: { tenantId: string; userId: string; envelopeId: string; key: string; filename: string }) {
  if (!isUploadKeyFor(i.key, i.tenantId, i.envelopeId)) throw new ValidationError("This upload does not belong to this envelope");
  const { bytes, info, sha256, filename } = await readUploadedPdf(i.key, i.filename);
  // Store the exact verified bytes where no signed upload URL can reach, then drop the upload.
  const docKey = documentKeyFor(i.tenantId, i.envelopeId);
  await putObject(docKey, bytes, "application/pdf");
  await deleteObject(i.key);
  const res = await withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const old = await tx.document.findUnique({ where: { envelopeId: i.envelopeId } });
    if (old) await tx.document.delete({ where: { id: old.id } }); // its fields cascade
    const doc = await tx.document.create({
      data: {
        tenantId: i.tenantId,
        envelopeId: i.envelopeId,
        filename,
        s3Key: docKey,
        sha256,
        pageCount: info.pageCount,
        pageSizes: info.pageSizes,
        sizeBytes: bytes.byteLength,
      },
    });
    await appendAudit(tx, {
      tenantId: i.tenantId,
      envelopeId: i.envelopeId,
      actorType: "user",
      actorId: i.userId,
      event: "document_uploaded",
      data: { filename, sha256, pageCount: info.pageCount },
    });
    return { documentId: doc.id, pageCount: info.pageCount, oldKey: old?.s3Key ?? null };
  }).catch(async (e) => {
    await deleteObject(docKey);
    throw e;
  });
  if (res.oldKey) await deleteObject(res.oldKey);
  return { documentId: res.documentId, pageCount: res.pageCount };
}

export async function getEnvelope(tenantId: string, envelopeId: string) {
  const env = await withTenant(tenantId, (tx) =>
    tx.envelope.findUnique({
      where: { id: envelopeId },
      include: {
        document: true,
        recipients: { orderBy: [{ routingOrder: "asc" }, { createdAt: "asc" }] },
        fields: { orderBy: [{ page: "asc" }, { y: "asc" }] },
      },
    }),
  );
  if (!env) throw new NotFoundError("Envelope not found");
  const { document, recipients, fields, ...envelope } = env;
  return {
    envelope,
    document: document ? { ...document, pageSizes: document.pageSizes as PageSize[] } : null,
    recipients,
    fields,
  };
}

export async function listEnvelopes(tenantId: string, filter: { status?: EnvelopeStatus; q?: string } = {}) {
  const q = filter.q?.trim().slice(0, 100);
  const rows = await withTenant(tenantId, (tx) =>
    tx.envelope.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        sentAt: true,
        _count: { select: { recipients: { where: { role: "signer" } } } },
        recipients: { where: { status: "signed" }, select: { id: true } },
      },
    }),
  );
  return rows.map(({ _count, recipients, ...e }) => ({ ...e, recipientCount: _count.recipients, signedCount: recipients.length }));
}

export async function countByStatus(tenantId: string): Promise<Record<EnvelopeStatus, number>> {
  const rows = await withTenant(tenantId, (tx) => tx.envelope.groupBy({ by: ["status"], _count: { _all: true } }));
  const out: Record<EnvelopeStatus, number> = { draft: 0, sent: 0, completed: 0, declined: 0, voided: 0, expired: 0 };
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

export async function deleteDraft(i: { tenantId: string; envelopeId: string }) {
  const key = await withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const doc = await tx.document.findUnique({ where: { envelopeId: i.envelopeId }, select: { s3Key: true } });
    await tx.envelope.delete({ where: { id: i.envelopeId } });
    return doc?.s3Key ?? null;
  });
  if (key) await deleteObject(key);
}

export async function voidEnvelope(i: { tenantId: string; userId: string; envelopeId: string; reason: string }) {
  const reason = i.reason.trim().slice(0, 500);
  if (!reason) throw new ValidationError("Give a reason for voiding");
  await withTenant(i.tenantId, async (tx) => {
    const env = await lockEnvelope(tx, i.envelopeId);
    if (env.status !== "sent") throw new InvalidStateError("Only sent envelopes can be voided");
    const voided = await tx.envelope.update({ where: { id: i.envelopeId }, data: { status: "voided", voidedAt: new Date(), voidReason: reason } });
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId, event: "voided", data: { reason } });
    // Tell everyone who already got a link; later steps never heard of it.
    const told = await tx.recipient.findMany({ where: { envelopeId: i.envelopeId, invitedAt: { not: null } } });
    const sender = await senderOf(tx, voided);
    for (const r of told) {
      await enqueueEmail(tx, {
        tenantId: i.tenantId,
        envelopeId: i.envelopeId,
        recipientId: r.id,
        kind: "voided",
        toEmail: r.email,
        toName: r.name,
        data: { title: voided.title, senderName: sender.name, reason },
      });
    }
  });
}

// Emails a signer a fresh link (their earlier link stops working).
export async function resendInvite(i: { tenantId: string; userId: string; envelopeId: string; recipientId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    const env = await lockEnvelope(tx, i.envelopeId);
    if (env.status !== "sent" || !env.expiresAt || env.expiresAt <= new Date()) throw new InvalidStateError("Only open envelopes can be resent");
    const rec = await tx.recipient.findFirst({ where: { id: i.recipientId, envelopeId: i.envelopeId } });
    if (!rec) throw new NotFoundError("Recipient not found");
    if (rec.role !== "signer" || (rec.status !== "sent" && rec.status !== "viewed")) throw new InvalidStateError("This signer is not waiting to sign");
    await issueLink(tx, env, rec, "invite");
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId, event: "link_reissued", data: { to: rec.email } });
  });
}
