"use client";

import { useActionState } from "react";
import { createWorkspaceAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export default function OnboardingPage() {
  const [state, action, pending] = useActionState(createWorkspaceAction, {});
  return (
    <main className="grid min-h-screen place-items-center bg-yellow p-6">
      <Card className="w-full max-w-md">
        <p className="font-mono text-xs font-bold uppercase">Step 1 of 1</p>
        <h1 className="mt-2 font-display text-4xl">Name your workspace.</h1>
        <p className="mt-2">Usually your company or team name. You can invite teammates next.</p>
        <form action={action} className="mt-6 space-y-4">
          <Input label="Workspace name" name="name" required minLength={2} maxLength={60} />
          {state.error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{state.error}</p>}
          <Button variant="primary" disabled={pending} className="w-full justify-center">
            {pending ? "Creating..." : "Create workspace"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
