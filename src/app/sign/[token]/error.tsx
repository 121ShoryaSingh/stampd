"use client";

import { Button } from "@/components/ui/button";

// Fallback for signers when something unexpected breaks.
export default function SignError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="border-brutal shadow-hard mx-auto max-w-lg bg-paper p-6">
      <h1 className="font-display text-3xl">Something went wrong.</h1>
      <p className="mt-2">Nothing was signed. Please try again in a moment, or contact the sender.</p>
      <Button variant="primary" className="mt-5" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
