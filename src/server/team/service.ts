import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { withDb, withTenant, type Tx } from "@/server/db/context";
import type { Role } from "@/server/db/types";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { normalizeEmail } from "./email";

export const INVITE_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Queries below run inside withTenant, so RLS already limits them to one tenant.
async function roleOf(tx: Tx, tenantId: string, userId: string): Promise<Role | null> {
  const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  return m?.role ?? null;
}

async function assertAdmin(tx: Tx, tenantId: string, userId: string) {
  if ((await roleOf(tx, tenantId, userId)) !== "admin") throw new ForbiddenError("Only admins can do that");
}

// Touching the tenant row locks it, so concurrent team changes run one at a time.
async function lockTeam(tx: Tx, tenantId: string) {
  await tx.tenant.update({ where: { id: tenantId }, data: { updatedAt: new Date() } });
}

async function assertNotLastAdmin(tx: Tx, targetUserId: string) {
  const admins = await tx.membership.findMany({ where: { role: "admin" }, select: { userId: true } });
  if (admins.length === 1 && admins[0].userId === targetUserId) {
    throw new ConflictError("A workspace needs at least one admin. Promote someone else first (last admin).");
  }
}

export async function createInvitation(i: { tenantId: string; actorUserId: string; email: string; role: Role }) {
  const email = normalizeEmail(i.email);
  const token = randomBytes(32).toString("base64url");
  return withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.tenantId, i.actorUserId);
    const existing = await tx.membership.findFirst({ where: { user: { email: { equals: email, mode: "insensitive" } } } });
    if (existing) throw new ConflictError(`${email} is already a member`);
    await tx.invitation.deleteMany({ where: { email, acceptedAt: null } });
    const row = await tx.invitation.create({
      data: {
        tenantId: i.tenantId,
        email,
        role: i.role,
        tokenHash: hashToken(token),
        invitedBy: i.actorUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      },
    });
    return { invitationId: row.id, token };
  });
}

export async function acceptInvitation(i: { token: string; userId: string; userEmail: string }): Promise<{ tenantId: string }> {
  const tokenHash = hashToken(i.token);
  const found = await withDb({ tokenHash }, (tx) =>
    tx.invitation.findFirst({ where: { tokenHash, acceptedAt: null, expiresAt: { gt: new Date() } } }),
  );
  if (!found) throw new NotFoundError("This invitation is invalid or has expired");
  if (found.email !== normalizeEmail(i.userEmail)) {
    throw new ForbiddenError(`This invitation was sent to a different email (${found.email})`);
  }
  return withTenant(found.tenantId, async (tx) => {
    // Claim the invitation atomically; a second accept finds nothing to update.
    const claimed = await tx.invitation.updateMany({
      where: { id: found.id, acceptedAt: null, expiresAt: { gt: new Date() } },
      data: { acceptedAt: new Date() },
    });
    if (claimed.count === 0) throw new NotFoundError("This invitation is invalid or has expired");
    await tx.membership.upsert({
      where: { tenantId_userId: { tenantId: found.tenantId, userId: i.userId } },
      create: { tenantId: found.tenantId, userId: i.userId, role: found.role },
      update: {},
    });
    return { tenantId: found.tenantId };
  });
}

export async function listMembers(tenantId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx.membership.findMany({ include: { user: true }, orderBy: { createdAt: "asc" } }),
  );
  return rows.map((m) => ({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role }));
}

export async function listPendingInvitations(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true },
      orderBy: { createdAt: "asc" },
    }),
  );
}

export async function revokeInvitation(i: { tenantId: string; actorUserId: string; invitationId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.tenantId, i.actorUserId);
    await tx.invitation.deleteMany({ where: { id: i.invitationId, acceptedAt: null } });
  });
}

export async function changeRole(i: { tenantId: string; actorUserId: string; targetUserId: string; role: Role }) {
  await withTenant(i.tenantId, async (tx) => {
    await lockTeam(tx, i.tenantId);
    await assertAdmin(tx, i.tenantId, i.actorUserId);
    if (i.role === "member") await assertNotLastAdmin(tx, i.targetUserId);
    const res = await tx.membership.updateMany({ where: { userId: i.targetUserId }, data: { role: i.role } });
    if (res.count === 0) throw new NotFoundError("Member not found");
  });
}

export async function removeMember(i: { tenantId: string; actorUserId: string; targetUserId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    await lockTeam(tx, i.tenantId);
    if (i.actorUserId !== i.targetUserId) await assertAdmin(tx, i.tenantId, i.actorUserId);
    await assertNotLastAdmin(tx, i.targetUserId);
    const res = await tx.membership.deleteMany({ where: { userId: i.targetUserId } });
    if (res.count === 0) throw new NotFoundError("Member not found");
  });
}
