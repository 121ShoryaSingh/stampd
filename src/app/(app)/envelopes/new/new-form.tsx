"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { createEnvelopeAction } from "./actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

// Step 1 of the wizard for an envelope that does not exist yet; saving creates it and moves on to the PDF.
export function NewEnvelopeForm() {
  const [state, action, pending] = useActionState(createEnvelopeAction, {});
  return (
    <Card>
      <h2 className="font-display text-2xl">What is this envelope?</h2>
      <form action={action} className="mt-4 space-y-4">
        <Input label="Title" name="title" required maxLength={200} />
        <p className="font-mono text-xs">Signers see this title in their email and on the signing page.</p>
        {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{state.error}</p>}
        <Button variant="primary" size="lg" loading={pending}>
          Save and continue <ArrowRight aria-hidden className="h-5 w-5" />
        </Button>
      </form>
    </Card>
  );
}
