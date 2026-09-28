import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { withDb, withTenant, type Tx } from "@/server/db/context";
import { appendAudit } from "@/server/audit/service";
import { renderEmail, type EmailData, type EmailKind } from "./templates";
import { sendMail, type OutgoingMail } from "./mailer";

export type EmailJobInput<K extends EmailKind = EmailKind> = {
  tenantId: string;
  envelopeId?: string | null; // none for team invitations
  recipientId?: string | null;
  kind: K;
  toEmail: string;
  toName?: string | null;
  data: EmailData[K];
};

// Call inside the transaction that makes the change the email is about.
export async function enqueueEmail<K extends EmailKind>(tx: Tx, j: EmailJobInput<K>) {
  await tx.emailJob.create({
    data: {
      tenantId: j.tenantId,
      envelopeId: j.envelopeId ?? null,
      recipientId: j.recipientId ?? null,
      kind: j.kind,
      toEmail: j.toEmail,
      toName: j.toName ?? null,
      data: j.data as Prisma.InputJsonValue,
    },
  });
}

// Account emails (password reset) belong to no workspace; RLS lets the app insert them and only the worker read them.
export async function queueAccountEmail<K extends "password_reset">(j: { kind: K; toEmail: string; toName?: string | null; data: EmailData[K] }) {
  // createMany: no RETURNING, which RLS would refuse since the app cannot read these rows.
  await withDb({}, (tx) =>
    tx.emailJob.createMany({ data: [{ kind: j.kind, toEmail: j.toEmail, toName: j.toName ?? null, data: j.data as Prisma.InputJsonValue }] }),
  );
}

export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 120_000;
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];

type Sender = (m: OutgoingMail) => Promise<void>;
type Claimed = { id: string; tenantId: string | null; envelopeId: string | null; kind: string; toEmail: string; toName: string | null; data: unknown; attempts: number };

// Workspace jobs are written in their tenant's context; account jobs through the worker flag.
function inScope<T>(tenantId: string | null, fn: (tx: Tx) => Promise<T>) {
  return tenantId ? withTenant(tenantId, fn) : withDb({ worker: true }, fn);
}

// Envelope emails show up in the envelope's audit trail.
async function auditJob(tx: Tx, job: Claimed, event: string, data: Record<string, unknown>) {
  if (job.tenantId && job.envelopeId) await appendAudit(tx, { tenantId: job.tenantId, envelopeId: job.envelopeId, actorType: "system", event, data });
}

// Links and codes are only needed until the email is out.
function scrub(data: unknown): Prisma.InputJsonValue {
  return Object.fromEntries(Object.entries((data ?? {}) as Record<string, unknown>).filter(([k]) => k !== "url" && k !== "code")) as Prisma.InputJsonValue;
}

// Takes a 2-minute lease on a due job; only one worker wins it.
async function claim(ref: { id: string; tenantId: string | null }, now: Date): Promise<Claimed | null> {
  return inScope(ref.tenantId, async (tx) => {
    const won = await tx.emailJob.updateMany({
      where: { id: ref.id, status: "queued", runAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
    });
    if (won.count === 0) return null;
    return tx.emailJob.findUniqueOrThrow({ where: { id: ref.id } });
  });
}

async function markSent(job: Claimed, now: Date) {
  await inScope(job.tenantId, async (tx) => {
    await tx.emailJob.update({ where: { id: job.id }, data: { status: "sent", sentAt: now, lockedUntil: null, lastError: null, data: scrub(job.data) } });
    await auditJob(tx, job, "email_sent", { kind: job.kind, to: job.toEmail });
  });
}

async function markFailed(job: Claimed, error: string, now: Date): Promise<"failed" | "retried"> {
  const final = job.attempts >= MAX_ATTEMPTS;
  await inScope(job.tenantId, async (tx) => {
    if (final) {
      await tx.emailJob.update({ where: { id: job.id }, data: { status: "failed", lockedUntil: null, lastError: error, data: scrub(job.data) } });
      await auditJob(tx, job, "email_failed", { kind: job.kind, to: job.toEmail, error });
    } else {
      const wait = BACKOFF_MS[Math.min(job.attempts, BACKOFF_MS.length) - 1];
      await tx.emailJob.update({ where: { id: job.id }, data: { runAt: new Date(now.getTime() + wait), lockedUntil: null, lastError: error } });
    }
  });
  return final ? "failed" : "retried";
}

// Sends due jobs once each. Safe to run from several workers at the same time.
// tenantId narrows the run to one workspace, or to account emails when null (tests, manual runs).
export async function processDueEmails(o: { now?: () => Date; send?: Sender; limit?: number; tenantId?: string | null } = {}) {
  const now = o.now ?? (() => new Date());
  const send = o.send ?? sendMail;
  const t = now();
  const due = await withDb({ worker: true }, (tx) =>
    tx.emailJob.findMany({
      where: { status: "queued", runAt: { lte: t }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: t } }], ...(o.tenantId !== undefined ? { tenantId: o.tenantId } : {}) },
      orderBy: { runAt: "asc" },
      take: o.limit ?? 20,
      select: { id: true, tenantId: true },
    }),
  );
  const out = { sent: 0, failed: 0, retried: 0 };
  for (const ref of due) {
    const job = await claim(ref, now());
    if (!job) continue;
    try {
      const m = renderEmail(job.kind as EmailKind, job.data as EmailData[EmailKind]);
      await send({ to: job.toEmail, toName: job.toName, ...m });
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);
      out[await markFailed(job, msg, now())]++;
      continue;
    }
    await markSent(job, now());
    out.sent++;
  }
  return out;
}

export type Delivery = { kind: string; status: "queued" | "sent" | "failed"; lastError: string | null; at: Date };

// Latest link email (invite or reminder) per recipient, for the envelope page.
export async function deliveries(tenantId: string, envelopeId: string): Promise<Record<string, Delivery>> {
  const jobs = await withTenant(tenantId, (tx) =>
    tx.emailJob.findMany({ where: { envelopeId, kind: { in: ["invite", "reminder"] }, recipientId: { not: null } }, orderBy: { createdAt: "asc" } }),
  );
  const out: Record<string, Delivery> = {};
  for (const j of jobs) out[j.recipientId!] = { kind: j.kind, status: j.status, lastError: j.lastError, at: j.sentAt ?? j.createdAt };
  return out;
}
