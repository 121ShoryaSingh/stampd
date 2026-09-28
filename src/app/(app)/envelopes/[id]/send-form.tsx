"use client";

import { useActionState, useState } from "react";
import { sendAction } from "./actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker, daysUntil } from "@/components/ui/date-picker";

const DAY = 86_400_000;

export function SendForm({ envelopeId }: { envelopeId: string }) {
  const { show } = useToast();
  // The page re-renders as "sent" and unmounts this form, so toast as soon as the action returns.
  const [state, action, pending] = useActionState(async (prev: Awaited<ReturnType<typeof sendAction>>, form: FormData) => {
    const res = await sendAction(prev, form);
    if (res.invited) show("Sent. Signing emails are on their way.");
    return res;
  }, {});
  const [days, setDays] = useState(30);
  // Fixed when the form mounts, so the calendar bounds do not move while it is open.
  const [today] = useState(() => Date.now());
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="envelopeId" value={envelopeId} />
      <div className="grid grid-cols-2 gap-4">
        <DatePicker
          label="Expires on"
          name="expiresOn"
          defaultValue={new Date(today + 30 * DAY)}
          minDate={new Date(today + DAY)}
          maxDate={new Date(today + 365 * DAY)}
          onChange={(d) => setDays(daysUntil(d))}
        />
        <input type="hidden" name="expiresInDays" value={days} />
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
