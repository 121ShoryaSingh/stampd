"use client";

import { useActionState, useState } from "react";
import { Send } from "lucide-react";
import { sendAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker, daysUntil } from "@/components/ui/date-picker";
import { WizardNav } from "@/components/app/wizard-nav";

const DAY = 86_400_000;

// Last wizard step; on success the action redirects to the envelope's status page.
export function SendForm({ envelopeId, back }: { envelopeId: string; back: { href: string; label: string } }) {
  const [state, action, pending] = useActionState(sendAction, {});
  const [days, setDays] = useState(30);
  // Fixed when the form mounts, so the calendar bounds do not move while it is open.
  const [today] = useState(() => Date.now());
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="envelopeId" value={envelopeId} />
      <div className="grid gap-4 sm:grid-cols-2">
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
      <WizardNav
        back={back}
        next={
          <div className="flex flex-wrap items-center gap-3">
            {state.error && <p role="alert" className="border-brutal bg-red p-2 text-sm font-bold text-ink">{state.error}</p>}
            <Button variant="primary" size="lg" loading={pending} icon={<Send aria-hidden className="h-5 w-5" />}>
              {pending ? "Sending..." : "Send for signature"}
            </Button>
          </div>
        }
      />
    </form>
  );
}
