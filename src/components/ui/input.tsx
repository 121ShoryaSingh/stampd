import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export function FieldShell({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs opacity-70">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-bold text-red">
          {error}
        </p>
      )}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export const fieldClass = (error?: string) =>
  `border-brutal w-full bg-paper px-3 py-2.5 outline-none transition-colors focus:bg-yellow ${error ? "border-red bg-red/5" : ""}`;

export function Input({ label, hint, error, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        placeholder={`Enter ${label.toLowerCase()}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${fieldClass(error)} ${className}`}
        {...props}
      />
    </FieldShell>
  );
}
