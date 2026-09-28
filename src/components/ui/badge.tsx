import type { ReactNode } from "react";

const tones = {
  paper: "bg-paper",
  yellow: "bg-yellow",
  green: "bg-green",
  pink: "bg-pink",
  red: "bg-red text-white",
  ink: "bg-ink text-paper",
  blue: "bg-blue text-white",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "paper", icon, children }: { tone?: BadgeTone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className={`border-brutal pop inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${tones[tone]}`}>
      {icon}
      {children}
    </span>
  );
}
