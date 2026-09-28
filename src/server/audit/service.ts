import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db/context";
import type { ActorType } from "@/server/db/types";
import { canonicalJson } from "./canonical";

export type AuditInput = {
  tenantId: string;
  envelopeId: string;
  actorType: ActorType;
  actorId?: string | null;
  event: string;
  ip?: string | null;
  userAgent?: string | null;
  data?: Record<string, unknown>;
};

type Hashable = {
  tenantId: string;
  envelopeId: string;
  seq: number;
  actorType: ActorType;
  actorId: string | null;
  event: string;
  ip: string | null;
  userAgent: string | null;
  data: unknown;
  createdAt: string;
};

function hashEvent(prevHash: string | null, e: Hashable): string {
  return createHash("sha256").update(`${prevHash ?? ""}|${canonicalJson(e)}`).digest("hex");
}

export async function appendAudit(tx: Tx, e: AuditInput): Promise<{ seq: number; hash: string }> {
  // Incrementing the counter locks the envelope row, so appends per envelope run one at a time.
  const { auditSeq: seq } = await tx.envelope.update({
    where: { id: e.envelopeId },
    data: { auditSeq: { increment: 1 } },
    select: { auditSeq: true },
  });
  const prev = await tx.auditEvent.findUnique({
    where: { envelopeId_seq: { envelopeId: e.envelopeId, seq: seq - 1 } },
    select: { hash: true },
  });
  const prevHash = prev?.hash ?? null;
  const createdAt = new Date();
  const h: Hashable = {
    tenantId: e.tenantId,
    envelopeId: e.envelopeId,
    seq,
    actorType: e.actorType,
    actorId: e.actorId ?? null,
    event: e.event,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    data: e.data ?? {},
    createdAt: createdAt.toISOString(),
  };
  const hash = hashEvent(prevHash, h);
  await tx.auditEvent.create({
    data: { ...h, data: h.data as Prisma.InputJsonValue, createdAt, prevHash, hash },
  });
  return { seq, hash };
}

export function listAudit(tx: Tx, envelopeId: string) {
  return tx.auditEvent.findMany({ where: { envelopeId }, orderBy: { seq: "asc" } });
}

export async function verifyChain(tx: Tx, envelopeId: string) {
  let prev: string | null = null;
  for (const r of await listAudit(tx, envelopeId)) {
    const expected = hashEvent(prev, {
      tenantId: r.tenantId,
      envelopeId: r.envelopeId,
      seq: r.seq,
      actorType: r.actorType,
      actorId: r.actorId,
      event: r.event,
      ip: r.ip,
      userAgent: r.userAgent,
      data: r.data,
      createdAt: r.createdAt.toISOString(),
    });
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false as const, brokenAtSeq: r.seq };
    prev = r.hash;
  }
  return { ok: true as const, lastHash: prev };
}
