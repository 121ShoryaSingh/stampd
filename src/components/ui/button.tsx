import type { ButtonHTMLAttributes } from "react";

const variants = {
  default: "bg-paper text-ink",
  primary: "bg-red text-white",
  accent: "bg-yellow text-ink",
} as const;

export function Button({
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={`border-brutal shadow-hard-sm inline-flex items-center gap-2 px-5 py-3 text-sm font-bold uppercase tracking-wide transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-1 active:translate-y-1 active:shadow-none disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
