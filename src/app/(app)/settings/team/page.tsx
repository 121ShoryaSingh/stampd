import { UserPlus, Users } from "lucide-react";
import { requireTenant } from "@/server/tenants/current";
import { listMembers, listPendingInvitations } from "@/server/team/service";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Table, THead, TRow, TH, TD } from "@/components/ui/layout";
import { InviteForm } from "./invite-form";
import { changeRoleAction, removeMemberAction, revokeInviteAction } from "./actions";

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, tenant } = await requireTenant();
  const [members, invites, { error }] = await Promise.all([listMembers(tenant.tenantId), listPendingInvitations(tenant.tenantId), searchParams]);
  const isAdmin = tenant.role === "admin";
  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader title="Team" subtitle={`${members.length} ${members.length === 1 ? "member" : "members"} in ${tenant.name}`} />
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{error}</p>}
      {isAdmin && (
        <Card className="rise">
          <h2 className="mb-4 flex items-center gap-2 font-display text-2xl">
            <UserPlus aria-hidden className="h-6 w-6" /> Invite a teammate
          </h2>
          <InviteForm />
        </Card>
      )}
      <Table>
        <THead>
          <tr>
            <TH>Member</TH>
            <TH>Role</TH>
            <TH className="text-right">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <tbody>
          {members.map((m, i) => (
            <TRow key={m.userId} className="rise" style={{ "--i": i } as React.CSSProperties}>
              <TD>
                <p className="font-bold">
                  {m.name}
                  {m.userId === session.user.id && <span className="ml-2 font-mono text-xs">(you)</span>}
                </p>
                <p className="break-all font-mono text-xs">{m.email}</p>
              </TD>
              <TD>
                {isAdmin ? (
                  <form action={changeRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={m.userId} />
                    <select name="role" defaultValue={m.role} aria-label={`Role for ${m.email}`} className="border-brutal bg-paper px-2 py-1 font-bold">
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                    </select>
                    <Button size="sm">Save</Button>
                  </form>
                ) : (
                  <Badge tone={m.role === "admin" ? "yellow" : "paper"}>{m.role}</Badge>
                )}
              </TD>
              <TD className="text-right">
                {(isAdmin || m.userId === session.user.id) && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="userId" value={m.userId} />
                    <Button size="sm" variant={m.userId === session.user.id ? "default" : "danger"}>
                      {m.userId === session.user.id ? "Leave" : "Remove"}
                    </Button>
                  </form>
                )}
              </TD>
            </TRow>
          ))}
        </tbody>
      </Table>
      {isAdmin && invites.length > 0 && (
        <Card>
          <h2 className="mb-4 flex items-center gap-2 font-display text-2xl">
            <Users aria-hidden className="h-6 w-6" /> Pending invitations
          </h2>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 pb-2">
                <span className="break-all">
                  {i.email} <Badge>{i.role}</Badge>
                </span>
                <form action={revokeInviteAction}>
                  <input type="hidden" name="invitationId" value={i.id} />
                  <Button size="sm">Revoke</Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
