import "server-only";
import { withDb, withTenant, type Tx } from "@/server/db/context";
import { hashToken } from "@/server/team/service";
import { InvalidStateError, NotFoundError } from "@/server/errors";
import type { EnvelopeStatus, RecipientRole, RecipientStatus } from "@/server/db/types";

export type SignerRef = { tenantId: string; envelopeId: string; recipientId: string };
export type SignerState = "ready" | "waiting" | "signed" | "declined" | "closed";
export type ReqMeta = { ip: string | null; userAgent: string | null };

// The token policy lets us read just this recipient row to learn its tenant.
export async function resolveSigner(token: string): Promise<SignerRef> {
  const tokenHash = hashToken(token);
  const r = await withDb({ tokenHash }, (tx) =>
    tx.recipient.findFirst({ where: { tokenHash }, select: { id: true, tenantId: true, envelopeId: true } }),
  );
  if (!r) throw new NotFoundError("This signing link is not valid");
  return { tenantId: r.tenantId, envelopeId: r.envelopeId, recipientId: r.id };
}

export function signerState(
  env: { status: EnvelopeStatus; expiresAt: Date | null },
  rec: { status: RecipientStatus; role: RecipientRole },
  now = new Date(),
): SignerState {
  if (rec.status === "signed") return "signed";
  if (rec.status === "declined") return "declined";
  if (rec.role === "cc" || env.status !== "sent") return "closed";
  if (!env.expiresAt || env.expiresAt <= now) return "closed";
  return rec.status === "pending" ? "waiting" : "ready";
}

const STATE_ERRORS: Record<Exclude<SignerState, "ready">, string> = {
  waiting: "It is not your turn to sign yet",
  signed: "You have already signed this envelope",
  declined: "You declined this envelope",
  closed: "This envelope is closed",
};

export async function loadSigner(tx: Tx, ref: SignerRef) {
  const rec = await tx.recipient.findUniqueOrThrow({ where: { id: ref.recipientId } });
  const env = await tx.envelope.findUniqueOrThrow({ where: { id: ref.envelopeId } });
  return { rec, env, state: signerState(env, rec) };
}

export async function requireReady(tx: Tx, ref: SignerRef) {
  const s = await loadSigner(tx, ref);
  if (s.state !== "ready") throw new InvalidStateError(STATE_ERRORS[s.state]);
  return s;
}

export function inTenant<T>(ref: SignerRef, fn: (tx: Tx) => Promise<T>) {
  return withTenant(ref.tenantId, fn);
}
