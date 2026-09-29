import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { buttonSizes, buttonVariants } from "./button";

// A link that looks like a Button, for navigation (Back, Next, open a page).
export function ButtonLink({
  variant = "default",
  size = "md",
  icon,
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonVariants; size?: keyof typeof buttonSizes; icon?: ReactNode }) {
  return (
    <Link
      className={`border-brutal shadow-hard-sm press inline-flex items-center gap-2 font-bold uppercase tracking-wide ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </Link>
  );
}
