"use client";

import { useActionState } from "react";
import { inviteAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1 basis-56">
        <Input label="Email" name="email" type="email" required />
      </div>
      <label className="block">
        <span className="mb-1 block font-mono text-xs font-bold uppercase">Role</span>
        <select name="role" defaultValue="member" className="border-brutal bg-paper px-3 py-2.5 font-bold">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <Button variant="primary" disabled={pending}>
        {pending ? "Inviting..." : "Invite"}
      </Button>
      {state.error && <p role="alert" className="border-brutal w-full bg-red p-3 font-bold text-ink">{state.error}</p>}
      {state.inviteUrl && (
        <div className="border-brutal w-full bg-green p-3">
          <p className="font-bold">Invite created. Send this link to your teammate:</p>
          <input
            readOnly
            value={state.inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Invite link"
            data-testid="invite-url"
            className="border-brutal mt-2 w-full bg-paper px-2 py-1 font-mono text-xs"
          />
        </div>
      )}
    </form>
  );
}
