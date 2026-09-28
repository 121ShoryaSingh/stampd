"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Friendly fallback for unexpected errors inside the app.
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="border-brutal shadow-hard mx-auto mt-10 max-w-lg bg-paper p-6">
      <AlertTriangle aria-hidden className="h-8 w-8" />
      <h1 className="mt-3 font-display text-3xl">Something went wrong.</h1>
      <p className="mt-2">This page could not load. Your data is safe. Try again, or go back to your envelopes.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
        <a href="/dashboard" className="border-brutal shadow-hard-sm press px-5 py-3 text-sm font-bold uppercase">
          Envelopes
        </a>
      </div>
    </div>
  );
}
