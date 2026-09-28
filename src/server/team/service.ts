import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { withTenant, type Tx } from "@/server/db/tenant";
import { invitations, memberships, type Role } from "@/server/db/schema";
import { user } from "@/server/db/auth-schema";
import { ConflictError, ForbiddenError, NotFoundError } from "@/server/errors";
import { normalizeEmail } from "./email";

export const INVITE_TTL_DAYS = 7;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Queries below run inside withTenant, so RLS already limits them to one tenant.
async function roleOf(tx: Tx, userId: string): Promise<Role | null> {
  const [m] = await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.userId, userId));
  return m?.role ?? null;
}

async function assertAdmin(tx: Tx, userId: string) {
  if ((await roleOf(tx, userId)) !== "admin") throw new ForbiddenError("Only admins can do that");
}

async function assertNotLastAdmin(tx: Tx, targetUserId: string) {
  // Lock admin rows so two concurrent demotions cannot both pass.
  const admins = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(eq(memberships.role, "admin"))
    .for("update");
  if (admins.length === 1 && admins[0].userId === targetUserId) {
    throw new ConflictError("A workspace needs at least one admin. Promote someone else first (last admin).");
  }
}

export async function createInvitation(i: { tenantId: string; actorUserId: string; email: string; role: Role }) {
  const email = normalizeEmail(i.email);
  const token = randomBytes(32).toString("base64url");
  return withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.actorUserId);
    const [existing] = await tx
      .select({ id: memberships.userId })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(sql`lower(${user.email}) = ${email}`);
    if (existing) throw new ConflictError(`${email} is already a member`);
    await tx.delete(invitations).where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)));
    const [row] = await tx
      .insert(invitations)
      .values({
        tenantId: i.tenantId,
        email,
        role: i.role,
        tokenHash: hashToken(token),
        invitedBy: i.actorUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      })
      .returning({ id: invitations.id });
    return { invitationId: row.id, token };
  });
}

export async function acceptInvitation(i: { token: string; userId: string; userEmail: string }): Promise<{ tenantId: string }> {
  const rows = await db.execute<{ tenant_id: string; invitation_id: string }>(
    sql`select * from resolve_invitation(${hashToken(i.token)})`,
  );
  const found = rows[0];
  if (!found) throw new NotFoundError("This invitation is invalid or has expired");
  return withTenant(found.tenant_id, async (tx) => {
    const [inv] = await tx
      .select()
      .from(invitations)
      .where(and(eq(invitations.id, found.invitation_id), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .for("update");
    if (!inv) throw new NotFoundError("This invitation is invalid or has expired");
    if (inv.email !== normalizeEmail(i.userEmail)) {
      throw new ForbiddenError(`This invitation was sent to a different email (${inv.email})`);
    }
    await tx.insert(memberships).values({ tenantId: found.tenant_id, userId: i.userId, role: inv.role }).onConflictDoNothing();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, inv.id));
    return { tenantId: found.tenant_id };
  });
}

export async function listMembers(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ userId: memberships.userId, name: user.name, email: user.email, role: memberships.role })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .orderBy(memberships.createdAt),
  );
}

export async function listPendingInvitations(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
      .orderBy(invitations.createdAt),
  );
}

export async function revokeInvitation(i: { tenantId: string; actorUserId: string; invitationId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.actorUserId);
    await tx.delete(invitations).where(and(eq(invitations.id, i.invitationId), isNull(invitations.acceptedAt)));
  });
}

export async function changeRole(i: { tenantId: string; actorUserId: string; targetUserId: string; role: Role }) {
  await withTenant(i.tenantId, async (tx) => {
    await assertAdmin(tx, i.actorUserId);
    if (i.role === "member") await assertNotLastAdmin(tx, i.targetUserId);
    const res = await tx
      .update(memberships)
      .set({ role: i.role })
      .where(eq(memberships.userId, i.targetUserId))
      .returning({ userId: memberships.userId });
    if (res.length === 0) throw new NotFoundError("Member not found");
  });
}

export async function removeMember(i: { tenantId: string; actorUserId: string; targetUserId: string }) {
  await withTenant(i.tenantId, async (tx) => {
    if (i.actorUserId !== i.targetUserId) await assertAdmin(tx, i.actorUserId);
    await assertNotLastAdmin(tx, i.targetUserId);
    const res = await tx
      .delete(memberships)
      .where(eq(memberships.userId, i.targetUserId))
      .returning({ userId: memberships.userId });
    if (res.length === 0) throw new NotFoundError("Member not found");
  });
}
