import { useId, type InputHTMLAttributes } from "react";

export function Input({ label, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">{label}</span>
      <input id={id} className={`border-brutal w-full bg-paper px-3 py-2.5 outline-none focus:bg-yellow ${className}`} {...props} />
    </label>
  );
}
