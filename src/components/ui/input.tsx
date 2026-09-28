import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Input as ShadcnInput } from "@/components/shadcn/input";
import { Label } from "@/components/shadcn/label";
import { cn } from "@/lib/utils";

export function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">
        {label}
      </Label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs opacity-70">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-bold text-red-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

// Brutalist overrides on top of shadcn's input classes.
export const fieldClass = (error?: string) =>
  cn(
    "h-auto border-brutal bg-paper px-3 py-2.5 text-base shadow-none outline-none transition-colors focus-visible:bg-yellow focus-visible:ring-0 md:text-base",
    error && "border-red bg-red/5",
  );

export function Input({ label, hint, error, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <ShadcnInput
        id={id}
        placeholder={`Enter ${label.toLowerCase()}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={cn(fieldClass(error), className)}
        {...props}
      />
    </FieldShell>
  );
}
