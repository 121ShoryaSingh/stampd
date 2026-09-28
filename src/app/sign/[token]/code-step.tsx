"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestCodeAction, verifyCodeAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function CodeStep({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const res = await requestCodeAction(token);
    setBusy(false);
    if (res.error) return setError(res.error);
    setSent(true);
    setDevCode(res.devCode ?? null);
  }

  async function verify(form: FormData) {
    setBusy(true);
    setError(null);
    const res = await verifyCodeAction(token, String(form.get("code") ?? ""));
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <Card className="mx-auto max-w-md">
      <h1 className="font-display text-3xl">Enter your code</h1>
      <p className="mt-2">
        We will send a 6-digit code to <b>{email}</b> to confirm it is you.
      </p>
      {!sent ? (
        <Button variant="primary" className="mt-6 w-full justify-center" onClick={send} disabled={busy}>
          {busy ? "Sending..." : "Send me a code"}
        </Button>
      ) : (
        <form action={verify} className="mt-6 space-y-4">
          {devCode && (
            <p className="border-brutal bg-yellow p-2 font-mono text-sm">
              Dev only (email arrives in a later plan): your code is <b data-testid="dev-code">{devCode}</b>
            </p>
          )}
          <Input label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
          <Button variant="primary" className="w-full justify-center" disabled={busy}>
            {busy ? "Checking..." : "Verify"}
          </Button>
          <button type="button" onClick={send} className="font-mono text-xs underline" disabled={busy}>
            Send a new code
          </button>
        </form>
      )}
      {error && <p role="alert" className="border-brutal mt-4 bg-red p-3 font-bold text-white">{error}</p>}
    </Card>
  );
}
