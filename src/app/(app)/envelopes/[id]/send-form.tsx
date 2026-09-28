"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { sendAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SendForm({ envelopeId }: { envelopeId: string }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(sendAction, {});
  if (state.links) {
    return (
      <div className="border-brutal bg-green p-4">
        <p className="font-display text-2xl">Sent.</p>
        <p className="mt-1">Signing emails are coming soon. Until then, share these links:</p>
        <ul className="mt-3 space-y-2">
          {state.links.map((l) => (
            <li key={l.email}>
              <span className="font-bold">{l.name}</span> <span className="font-mono text-xs">(step {l.routingOrder})</span>
              <input
                readOnly
                value={l.url}
                aria-label={`Signing link for ${l.email}`}
                onFocus={(e) => e.currentTarget.select()}
                className="border-brutal mt-1 w-full bg-paper px-2 py-1 font-mono text-xs"
              />
            </li>
          ))}
        </ul>
        <p className="mt-3 font-mono text-xs">These links are shown once. Copy them before you leave.</p>
        <Button type="button" className="mt-3" onClick={() => router.refresh()}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="envelopeId" value={envelopeId} />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Expires in (days)" name="expiresInDays" type="number" min={1} max={365} defaultValue={30} placeholder="Enter days" required />
        <Input label="Remind every (days, 0 = off)" name="reminderEveryDays" type="number" min={0} max={30} defaultValue={3} placeholder="Enter days" required />
      </div>
      <label className="block">
        <span className="mb-1 block font-mono text-xs font-bold uppercase">Message to signers (optional)</span>
        <textarea name="message" maxLength={2000} rows={3} placeholder="Enter message to signers" className="border-brutal w-full bg-paper p-3 outline-none focus:bg-yellow" />
      </label>
      {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{state.error}</p>}
      <Button variant="primary" disabled={pending}>
        {pending ? "Sending..." : "Send for signature"}
      </Button>
    </form>
  );
}
