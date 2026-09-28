import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { migratorSql, insertUser } from "../../../tests/helpers/db";
import { createTenant } from "@/server/tenants/service";
import {
  createInvitation,
  acceptInvitation,
  listMembers,
  listPendingInvitations,
  changeRole,
  removeMember,
  revokeInvitation,
  hashToken,
} from "./service";

const admin = migratorSql();
afterAll(async () => {
  await admin.end();
});

let owner: { id: string; email: string }, tenantId: string;
beforeEach(async () => {
  owner = await insertUser(admin);
  ({ id: tenantId } = await createTenant({ userId: owner.id, name: "Team Co" }));
});

async function addMember(role: "admin" | "member" = "member") {
  const u = await insertUser(admin);
  const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: u.email, role });
  await acceptInvitation({ token, userId: u.id, userEmail: u.email });
  return u;
}

describe("invitations", () => {
  it("invite + accept makes the user a member with the invited role", async () => {
    const u = await addMember("member");
    const members = await listMembers(tenantId);
    expect(members.find((m) => m.userId === u.id)?.role).toBe("member");
  });

  it("stores only a hash of the token", async () => {
    const { token, invitationId } = await createInvitation({ tenantId, actorUserId: owner.id, email: "hash@x.dev", role: "member" });
    const [row] = await admin`select token_hash from invitations where id = ${invitationId}`;
    expect(row.token_hash).toBe(hashToken(token));
    expect(row.token_hash).not.toContain(token);
  });

  it("matches emails case-insensitively on accept", async () => {
    const u = await insertUser(admin, `mixed-${Date.now()}@x.dev`);
    const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: `  ${u.email.toUpperCase()} `, role: "member" });
    await expect(acceptInvitation({ token, userId: u.id, userEmail: u.email })).resolves.toEqual({ tenantId });
  });

  it("rejects accepting with a different account email", async () => {
    const other = await insertUser(admin);
    const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: "someone@else.dev", role: "member" });
    await expect(acceptInvitation({ token, userId: other.id, userEmail: other.email })).rejects.toThrow(/different email/);
  });

  it("rejects a reused invitation", async () => {
    const u = await insertUser(admin);
    const { token } = await createInvitation({ tenantId, actorUserId: owner.id, email: u.email, role: "member" });
    await acceptInvitation({ token, userId: u.id, userEmail: u.email });
    await expect(acceptInvitation({ token, userId: u.id, userEmail: u.email })).rejects.toThrow(/invalid or has expired/);
  });

  it("rejects an expired invitation", async () => {
    const v = await insertUser(admin);
    const inv = await createInvitation({ tenantId, actorUserId: owner.id, email: v.email, role: "member" });
    await admin`update invitations set expires_at = now() - interval '1 minute' where id = ${inv.invitationId}`;
    await expect(acceptInvitation({ token: inv.token, userId: v.id, userEmail: v.email })).rejects.toThrow(/invalid or has expired/);
  });

  it("rejects inviting an existing member (case-insensitive)", async () => {
    const u = await addMember();
    await expect(
      createInvitation({ tenantId, actorUserId: owner.id, email: u.email.toUpperCase(), role: "member" }),
    ).rejects.toThrow(/already a member/);
  });

  it("re-inviting replaces the pending invitation", async () => {
    await createInvitation({ tenantId, actorUserId: owner.id, email: "re@x.dev", role: "member" });
    await createInvitation({ tenantId, actorUserId: owner.id, email: "re@x.dev", role: "admin" });
    const pending = (await listPendingInvitations(tenantId)).filter((i) => i.email === "re@x.dev");
    expect(pending).toHaveLength(1);
    expect(pending[0].role).toBe("admin");
  });

  it("members cannot invite or revoke", async () => {
    const m = await addMember("member");
    await expect(createInvitation({ tenantId, actorUserId: m.id, email: "n@x.dev", role: "member" })).rejects.toThrow(/admins/);
    const { invitationId } = await createInvitation({ tenantId, actorUserId: owner.id, email: "r@x.dev", role: "member" });
    await expect(revokeInvitation({ tenantId, actorUserId: m.id, invitationId })).rejects.toThrow(/admins/);
  });
});

describe("roles and removal", () => {
  it("admin can promote and demote", async () => {
    const m = await addMember();
    await changeRole({ tenantId, actorUserId: owner.id, targetUserId: m.id, role: "admin" });
    await changeRole({ tenantId, actorUserId: owner.id, targetUserId: m.id, role: "member" });
    expect((await listMembers(tenantId)).find((x) => x.userId === m.id)?.role).toBe("member");
  });

  it("cannot demote or remove the last admin", async () => {
    await expect(changeRole({ tenantId, actorUserId: owner.id, targetUserId: owner.id, role: "member" })).rejects.toThrow(/last admin/);
    await expect(removeMember({ tenantId, actorUserId: owner.id, targetUserId: owner.id })).rejects.toThrow(/last admin/);
  });

  it("a member can leave, but cannot remove others", async () => {
    const m1 = await addMember();
    const m2 = await addMember();
    await expect(removeMember({ tenantId, actorUserId: m1.id, targetUserId: m2.id })).rejects.toThrow(/admins/);
    await removeMember({ tenantId, actorUserId: m1.id, targetUserId: m1.id });
    expect((await listMembers(tenantId)).some((x) => x.userId === m1.id)).toBe(false);
  });
});
