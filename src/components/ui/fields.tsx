import { useId, type SelectHTMLAttributes, type TextareaHTMLAttributes, type InputHTMLAttributes } from "react";
import { FieldShell, describedBy, fieldClass } from "./input";

export function Textarea({ label, hint, error, className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
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

export function Select({ label, hint, error, className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} className={`${fieldClass(error)} font-bold ${className}`} {...props}>
        {children}
      </select>
    </FieldShell>
  );
}

export function Checkbox({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={`inline-flex cursor-pointer items-center gap-2 font-bold ${className}`}>
      <input type="checkbox" className="h-5 w-5 accent-ink" {...props} />
      {label}
    </label>
  );
}
