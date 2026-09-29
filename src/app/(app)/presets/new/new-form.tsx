"use client";

import { useActionState } from "react";
import { createPresetAction } from "../actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/fields";
import { Button } from "@/components/ui/button";

export function NewPresetForm() {
  const [state, action, pending] = useActionState(createPresetAction, {});
  return (
    <Card className="max-w-xl">
      <h1 className="font-display text-4xl">New preset.</h1>
      <p className="mt-2">Name it, then upload the PDF, add roles and place their fields.</p>
      <form action={action} className="mt-6 space-y-4">
        <Input label="Name" name="name" required maxLength={80} />
        <Textarea label="Description" name="description" maxLength={500} rows={3} />
        {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{state.error}</p>}
        <Button variant="primary" disabled={pending}>
          {pending ? "Creating..." : "Create preset"}
        </Button>
      </form>
    </Card>
  );
}
