"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { WizardNav } from "@/components/app/wizard-nav";
import { renameAction } from "../_wizard/actions";

export function DetailsForm({ envelopeId, title }: { envelopeId: string; title: string }) {
  const [state, action, pending] = useActionState(renameAction, {});
  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="envelopeId" value={envelopeId} />
      <div className="max-w-xl">
        <Input label="Title" name="title" required maxLength={200} defaultValue={title} />
        <p className="mt-2 font-mono text-xs">Signers see this title in their email and on the signing page.</p>
      </div>
      <WizardNav
        next={
          <div className="flex flex-wrap items-center gap-3">
            {state.error && <p role="alert" className="border-brutal bg-red p-2 text-sm font-bold text-ink">{state.error}</p>}
            <Button variant="primary" size="lg" loading={pending}>
              Save and continue <ArrowRight aria-hidden className="h-5 w-5" />
            </Button>
          </div>
        }
      />
    </form>
  );
}
