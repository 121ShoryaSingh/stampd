"use client";

import { useActionState } from "react";
import { usePresetAction } from "../../actions";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Role = { id: string; label: string; role: "signer" | "cc"; routingOrder: number; defaultName: string; defaultEmail: string };

export function UseForm({ presetId, defaultTitle, roles }: { presetId: string; defaultTitle: string; roles: Role[] }) {
  const [state, action, pending] = useActionState(usePresetAction.bind(null, presetId), {});
  return (
    <form action={action} className="mt-6 space-y-5">
      <Input label="Title" name="title" required maxLength={200} defaultValue={defaultTitle} />
      {roles.length === 0 && <p className="border-brutal bg-yellow p-4 font-bold">This preset has no roles yet.</p>}
      {roles.map((r) => (
        <fieldset key={r.id} className="border-brutal space-y-3 bg-paper p-3">
          <legend className="flex items-center gap-2 px-1 font-display text-xl">
            {r.label}
            <Badge>{r.role === "cc" ? "cc" : `signs ${ordinal(r.routingOrder)}`}</Badge>
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label={`${r.label} name`} name={`name:${r.id}`} required maxLength={120} defaultValue={r.defaultName} />
            <Input label={`${r.label} email`} name={`email:${r.id}`} type="email" required maxLength={300} defaultValue={r.defaultEmail} />
          </div>
        </fieldset>
      ))}
      {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{state.error}</p>}
      <Button variant="primary" disabled={pending || roles.length === 0}>
        {pending ? "Creating..." : "Create draft"}
      </Button>
    </form>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
