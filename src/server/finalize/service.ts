import "server-only";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { withDb, withTenant } from "@/server/db/context";
import { appendAudit, listAudit, verifyChain } from "@/server/audit/service";
import { enqueueEmail } from "@/server/email/outbox";
import { lockEnvelope } from "@/server/envelopes/service";
import { envelopeUrl, senderOf } from "@/server/envelopes/links";
import { sealedKeyFor } from "@/server/envelopes/keys";
import { deleteObject, getObjectBytes, presignGet, putObject } from "@/server/storage/storage";
import { InvalidStateError } from "@/server/errors";
import { env } from "@/server/env";
import { appendCertificate } from "./certificate";
import { embedFonts } from "./fonts";
import { loadSealKey, sealDocument, type SealKey } from "./seal";
import { stampFields } from "./stamp";
import { verifySeal } from "./verify";

export const SEAL_MAX_ATTEMPTS = 3;
export const SEAL_LEASE_MS = 300_000;
const SEAL_BACKOFF_MS = [60_000, 300_000];
const DOWNLOAD_TTL_S = 7 * 86_400; // the longest a presigned S3 link may live

let cachedKey: SealKey | undefined;

// The seal certificate from SEAL_P12_PATH or SEAL_P12_BASE64 (loaded once).
export function sealKey(): SealKey {
  if (cachedKey) return cachedKey;
  const file = env.SEAL_P12_PATH ? readFileSync(env.SEAL_P12_PATH) : env.SEAL_P12_BASE64 ? Buffer.from(env.SEAL_P12_BASE64, "base64") : null;
  if (!file) throw new Error("Sealing is not configured: set SEAL_P12_PATH or SEAL_P12_BASE64");
  cachedKey = loadSealKey(file, env.SEAL_P12_PASSWORD ?? "");
  return cachedKey;
}

export function sealConfigured(): boolean {
  return !!(env.SEAL_P12_PATH || env.SEAL_P12_BASE64);
}

// Builds the final PDF: original + stamped fields + certificate, sealed. Throws on any mismatch.
async function buildSignedPdf(tenantId: string, envelopeId: string, now: Date) {
  const data = await withTenant(tenantId, async (tx) => {
    const envelope = await tx.envelope.findUniqueOrThrow({
      where: { id: envelopeId },
      include: { document: true, recipients: { orderBy: [{ routingOrder: "asc" }, { createdAt: "asc" }] }, fields: true },
    });
    const chain = await verifyChain(tx, envelopeId);
    const events = await listAudit(tx, envelopeId);
    const userIds = [...new Set(events.filter((e) => e.actorType === "user" && e.actorId).map((e) => e.actorId!))];
    const users = await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    return { envelope, chain, events, users, sender: await senderOf(tx, envelope) };
  });
  const { envelope, chain, events } = data;
  const doc = envelope.document;
  if (!doc) throw new Error("The envelope has no document");
  if (!chain.ok) throw new Error(`The audit trail failed verification at event ${chain.brokenAtSeq}`);

  const original = await getObjectBytes(doc.s3Key);
  if (createHash("sha256").update(original).digest("hex") !== doc.sha256) throw new Error("The stored document no longer matches its hash");

  const pdf = await PDFDocument.load(original, { updateMetadata: false });
  const fonts = await embedFonts(pdf);
  const images = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const key of new Set(envelope.fields.map((f) => f.signatureS3Key).filter((k): k is string => !!k))) {
    images.set(key, await pdf.embedPng(await getObjectBytes(key)));
  }
  stampFields(
    pdf,
    envelope.fields.map((f) => ({ ...f, image: f.signatureS3Key ? images.get(f.signatureS3Key) : null })),
    fonts.regular,
  );
  appendCertificate(pdf, fonts, {
    envelopeId: envelope.id,
    title: envelope.title,
    sender: data.sender,
    sentAt: envelope.sentAt,
    completedAt: envelope.completedAt,
    document: { filename: doc.filename, pageCount: doc.pageCount, sha256: doc.sha256 },
    recipients: envelope.recipients,
    events,
    actors: Object.fromEntries(data.users.map((u) => [u.id, u.name])),
    auditHash: chain.lastHash ?? "",
    generatedAt: now,
  });
  pdf.setTitle(`${envelope.title} (signed)`);
  pdf.setProducer("Stampd");
  pdf.setModificationDate(now);
  const host = new URL(env.BETTER_AUTH_URL).host;
  const bytes = await sealDocument(pdf, sealKey(), {
    name: "Stampd",
    reason: `Signed by all parties with Stampd (envelope ${envelope.id})`,
    location: host,
    contactInfo: env.EMAIL_FROM_ADDRESS ?? host,
    signingTime: now,
  });
  const check = verifySeal(bytes);
  if (!check.valid) throw new Error(`The sealed PDF failed its own check: ${check.reason}`);
  return { bytes, envelope, sender: data.sender };
}

// Seals one completed envelope, stores the PDF and emails everyone their copy.
export async function finalizeEnvelope(tenantId: string, envelopeId: string, now = new Date()) {
  const { bytes, envelope, sender } = await buildSignedPdf(tenantId, envelopeId, now);
  const key = sealedKeyFor(tenantId, envelopeId, envelope.title);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await putObject(key, bytes, "application/pdf");
  const url = await presignGet(key, DOWNLOAD_TTL_S);
  const stored = await withTenant(tenantId, async (tx) => {
    const env = await lockEnvelope(tx, envelopeId);
    if (env.status !== "completed" || env.sealedS3Key) return false; // another worker won
    await tx.envelope.update({
      where: { id: envelopeId },
      data: { sealedS3Key: key, sealedSha256: sha256, sealRunAt: null, sealLockedUntil: null, lastError: null },
    });
    await appendAudit(tx, { tenantId, envelopeId, actorType: "system", event: "sealed", data: { sha256, bytes: bytes.length } });
    await enqueueEmail(tx, {
      tenantId,
      envelopeId,
      kind: "completed",
      toEmail: sender.email,
      toName: sender.name,
      data: { title: env.title, envelopeUrl: envelopeUrl(envelopeId), url },
    });
    for (const r of envelope.recipients) {
      await enqueueEmail(tx, {
        tenantId,
        envelopeId,
        recipientId: r.id,
        kind: "signed_copy",
        toEmail: r.email,
        toName: r.name,
        data: { title: env.title, senderName: sender.name, recipientName: r.name, url },
      });
    }
    return true;
  });
  if (!stored) await deleteObject(key);
  return { sealed: stored, sha256 };
}

// Takes a lease on a completed, unsealed envelope whose turn has come; only one worker wins.
async function claim(ref: { id: string; tenantId: string }, now: Date) {
  return withTenant(ref.tenantId, async (tx) => {
    const won = await tx.envelope.updateMany({
      where: { id: ref.id, status: "completed", sealedS3Key: null, sealRunAt: { lte: now }, OR: [{ sealLockedUntil: null }, { sealLockedUntil: { lt: now } }] },
      data: { sealLockedUntil: new Date(now.getTime() + SEAL_LEASE_MS), sealAttempts: { increment: 1 } },
    });
    if (won.count === 0) return null;
    return tx.envelope.findUniqueOrThrow({ where: { id: ref.id }, select: { sealAttempts: true } });
  });
}

async function markFailed(ref: { id: string; tenantId: string }, attempts: number, error: string, now: Date) {
  const final = attempts >= SEAL_MAX_ATTEMPTS;
  await withTenant(ref.tenantId, async (tx) => {
    const wait = SEAL_BACKOFF_MS[Math.min(attempts, SEAL_BACKOFF_MS.length) - 1];
    await tx.envelope.update({
      where: { id: ref.id },
      data: { sealLockedUntil: null, lastError: error, sealRunAt: final ? null : new Date(now.getTime() + wait) },
    });
    if (final) await appendAudit(tx, { tenantId: ref.tenantId, envelopeId: ref.id, actorType: "system", event: "seal_failed", data: { error } });
  });
  return final ? "failed" : "retried";
}

// Seals due envelopes. Safe to run from several workers; tenantId narrows a run (tests, manual runs).
export async function processDueFinalizations(o: { now?: () => Date; limit?: number; tenantId?: string } = {}) {
  const now = o.now ?? (() => new Date());
  const t = now();
  const due = await withDb({ worker: true }, (tx) =>
    tx.envelope.findMany({
      where: {
        status: "completed",
        sealedS3Key: null,
        sealRunAt: { lte: t },
        OR: [{ sealLockedUntil: null }, { sealLockedUntil: { lt: t } }],
        ...(o.tenantId ? { tenantId: o.tenantId } : {}),
      },
      orderBy: { sealRunAt: "asc" },
      take: o.limit ?? 5,
      select: { id: true, tenantId: true },
    }),
  );
  const out = { sealed: 0, failed: 0, retried: 0 };
  for (const ref of due) {
    const claimed = await claim(ref, now());
    if (!claimed) continue;
    try {
      if ((await finalizeEnvelope(ref.tenantId, ref.id, now())).sealed) out.sealed++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);
      out[await markFailed(ref, claimed.sealAttempts, msg, now())]++;
    }
  }
  return out;
}

// Sender's "try again" after the automatic retries gave up.
export async function retryFinalize(i: { tenantId: string; userId: string; envelopeId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    const env = await lockEnvelope(tx, i.envelopeId);
    if (env.status !== "completed" || env.sealedS3Key || env.sealRunAt) throw new InvalidStateError("This envelope is not waiting for a retry");
    await tx.envelope.update({ where: { id: i.envelopeId }, data: { sealAttempts: 0, sealRunAt: new Date(), lastError: null } });
    await appendAudit(tx, { tenantId: i.tenantId, envelopeId: i.envelopeId, actorType: "user", actorId: i.userId, event: "seal_retried" });
  });
}
