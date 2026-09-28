"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function ForgotForm() {
  const [sent, setSent] = useState<string | null>(null);
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email")).trim().toLowerCase();
    const res = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong, please try again");
    setSent(email);
  }

  return (
    <Card>
      <h1 className="font-display text-4xl">Forgot your password?</h1>
      {sent ? (
        <p role="status" className="mt-6">
          If there is a Stampd account for <b>{sent}</b>, we emailed it a link to choose a new password. The link works for 1 hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <p>Enter your email and we will send you a link to choose a new password.</p>
          <Input label="Work email" name="email" type="email" required autoComplete="email" />
          {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{error}</p>}
          <Button variant="primary" type="submit" disabled={pending || !hydrated} className="w-full justify-center">
            {pending ? "Sending..." : "Email me a reset link"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-bold underline">
          Back to log in
        </Link>
      </p>
    </Card>
  );
}
