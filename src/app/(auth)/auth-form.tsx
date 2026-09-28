"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/server/auth/safe-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim().toLowerCase();
    const password = String(f.get("password"));
    const res =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: String(f.get("name")).trim() })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (res.error) return setError(res.error.message ?? "Something went wrong");
    // New accounts without a specific destination go to onboarding.
    router.push(mode === "signup" && next === "/dashboard" ? "/onboarding" : next);
    router.refresh();
  }

  const other = mode === "login" ? "signup" : "login";
  const qs = params.get("next") ? `?next=${encodeURIComponent(next)}` : "";
  return (
    <Card>
      <h1 className="font-display text-4xl">{mode === "login" ? "Welcome back." : "Start signing."}</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        {mode === "signup" && <Input label="Your name" name="name" required minLength={2} autoComplete="name" />}
        <Input label="Work email" name="email" type="email" required autoComplete="email" />
        <Input
          label="Password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}
        <Button variant="primary" type="submit" disabled={pending} className="w-full justify-center">
          {pending ? "Working..." : mode === "login" ? "Log in" : "Create account"}
        </Button>
      </form>
      <p className="mt-6 text-sm">
        {mode === "login" ? "New here? " : "Have an account? "}
        <Link href={`/${other}${qs}`} className="font-bold underline">
          {other === "login" ? "Log in" : "Sign up"}
        </Link>
      </p>
    </Card>
  );
}
