"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password"));
    if (password !== String(f.get("confirm"))) return setError("The two passwords do not match");
    setPending(true);
    const res = await authClient.resetPassword({ newPassword: password, token: token! });
    setPending(false);
    if (res.error) return setError(res.error.message ?? "This link is no longer valid. Ask for a new one.");
    router.push("/login?reset=1");
  }

  if (!token || params.get("error")) {
    return (
      <Card>
        <h1 className="font-display text-4xl">Link expired</h1>
        <p className="mt-6">This reset link is invalid or has expired. Links work for 1 hour and only once.</p>
        <p className="mt-6">
          <Link href="/forgot-password" className="font-bold underline">
            Ask for a new link
          </Link>
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="font-display text-4xl">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Input label="New password" name="password" type="password" required minLength={10} autoComplete="new-password" hint="At least 10 characters" />
        <Input label="Repeat new password" name="confirm" type="password" required minLength={10} autoComplete="new-password" />
        {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{error}</p>}
        <Button variant="primary" type="submit" disabled={pending || !hydrated} className="w-full justify-center">
          {pending ? "Saving..." : "Save new password"}
        </Button>
      </form>
      <p className="mt-4 text-sm">Saving signs you out on every device.</p>
    </Card>
  );
}
