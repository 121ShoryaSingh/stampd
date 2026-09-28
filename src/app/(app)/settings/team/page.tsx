import { requireTenant } from "@/server/tenants/current";
import { listMembers, listPendingInvitations } from "@/server/team/service";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InviteForm } from "./invite-form";
import { changeRoleAction, removeMemberAction, revokeInviteAction } from "./actions";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, tenant } = await requireTenant();
  const [members, invites, { error }] = await Promise.all([
    listMembers(tenant.tenantId),
    listPendingInvitations(tenant.tenantId),
    searchParams,
  ]);
  const isAdmin = tenant.role === "admin";
  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="font-display text-5xl">Team</h1>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}
      {isAdmin && (
        <Card>
          <h2 className="mb-4 font-display text-2xl">Invite a teammate</h2>
          <InviteForm />
        </Card>
      )}
      <Card className="p-0">
        <table className="w-full text-left">
          <thead className="border-b-[2.5px] border-ink font-mono text-xs uppercase">
            <tr>
              <th className="p-4">Name</th>
              <th className="p-4">Email</th>
              <th className="p-4">Role</th>
              <th className="p-4" />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className="border-b border-ink/20">
                <td className="p-4 font-bold">
                  {m.name}
                  {m.userId === session.user.id && " (you)"}
                </td>
                <td className="p-4">{m.email}</td>
                <td className="p-4">
                  {isAdmin ? (
                    <form action={changeRoleAction} className="flex gap-2">
                      <input type="hidden" name="userId" value={m.userId} />
                      <select name="role" defaultValue={m.role} aria-label={`Role for ${m.email}`} className="border-brutal px-2 py-1">
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                      <Button className="px-3 py-1">Save</Button>
                    </form>
                  ) : (
                    <span className="font-mono uppercase">{m.role}</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  {(isAdmin || m.userId === session.user.id) && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="userId" value={m.userId} />
                      <Button className="px-3 py-1">{m.userId === session.user.id ? "Leave" : "Remove"}</Button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {isAdmin && invites.length > 0 && (
        <Card>
          <h2 className="mb-4 font-display text-2xl">Pending invitations</h2>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center justify-between border-b border-ink/20 pb-2">
                <span>
                  {i.email} <span className="font-mono text-xs uppercase">({i.role})</span>
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="invitationId" value={i.id} />
                  <Button className="px-3 py-1">Revoke</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
