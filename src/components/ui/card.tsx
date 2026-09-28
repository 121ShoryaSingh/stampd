import type { HTMLAttributes } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`border-brutal shadow-hard bg-paper p-6 ${className}`} {...props} />;
}
