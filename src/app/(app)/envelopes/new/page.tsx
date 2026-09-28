"use client";

import { useActionState } from "react";
import { createEnvelopeAction } from "./actions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function NewEnvelopePage() {
  const [state, action, pending] = useActionState(createEnvelopeAction, {});
  return (
    <Card className="max-w-xl">
      <h1 className="font-display text-4xl">New envelope.</h1>
      <form action={action} className="mt-6 space-y-4">
        <Input label="Title" name="title" required maxLength={200} placeholder="Mutual NDA - Acme" />
        {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{state.error}</p>}
        <Button variant="primary" disabled={pending}>
          {pending ? "Creating..." : "Create and upload PDF"}
        </Button>
      </form>
    </Card>
  );
}
