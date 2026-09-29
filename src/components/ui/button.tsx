import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";

export const buttonVariants = {
  default: "bg-paper text-ink",
  primary: "bg-red text-ink",
  accent: "bg-yellow text-ink",
  ghost: "bg-transparent text-ink shadow-none border-transparent hover:border-ink",
  danger: "bg-ink text-paper",
} as const;

export const buttonSizes = { sm: "px-3 py-1.5 text-xs", md: "px-5 py-3 text-sm", lg: "px-7 py-4 text-base" } as const;

export function Button({
  variant = "default",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`border-brutal shadow-hard-sm press inline-flex items-center gap-2 font-bold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
