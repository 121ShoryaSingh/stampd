"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { consentAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function ConsentStep({ token, title, message }: { token: string; title: string; message: string | null }) {
  const router = useRouter();
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    const res = await consentAction(token);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <Card className="mx-auto max-w-xl">
      <h1 className="font-display text-3xl">Before you sign</h1>
      <p className="mt-2">
        You are about to review and sign <b>{title}</b>.
      </p>
      {message && <blockquote className="border-brutal mt-4 bg-yellow/40 p-3">{message}</blockquote>}
      <label className="mt-6 flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I agree to use electronic records and signatures, and I understand my electronic signature is as binding as a handwritten one.</span>
      </label>
      <Button variant="primary" className="mt-6 w-full justify-center" disabled={!agree} onClick={go}>
        I agree
      </Button>
      {error && <p role="alert" className="border-brutal mt-4 bg-red p-3 font-bold text-white">{error}</p>}
    </Card>
  );
}
