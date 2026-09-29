import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="break-words font-display text-4xl md:text-5xl">{title}</h1>
        {subtitle && <div className="mt-2 font-mono text-sm">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({ label, value, hint, tone = "bg-paper", index = 0 }: { label: string; value: ReactNode; hint?: string; tone?: string; index?: number }) {
  return (
    <div className={`border-brutal shadow-hard-sm rise p-4 ${tone}`} style={{ "--i": index } as React.CSSProperties}>
      <p className="font-mono text-[11px] font-bold uppercase tracking-wider">{label}</p>
      <p className="mt-1 font-display text-4xl leading-none">{value}</p>
      {hint && <p className="mt-2 text-xs">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="border-brutal rise flex flex-col items-center gap-3 border-dashed bg-paper px-6 py-12 text-center">
      {icon && <div className="border-brutal bg-yellow p-3">{icon}</div>}
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="max-w-md">{body}</p>
      {action}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`shimmer bg-ink/10 ${className}`} />;
}

export function Table({ className = "", ...p }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="border-brutal shadow-hard relative overflow-x-auto overflow-y-hidden bg-paper">
      <table className={`w-full text-left ${className}`} {...p} />
    </div>
  );
}
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="border-b-[2.5px] border-ink font-mono text-xs uppercase" {...p} />;
export const TRow = ({ className = "", ...p }: HTMLAttributes<HTMLTableRowElement>) => <tr className={`border-b border-ink/15 last:border-0 ${className}`} {...p} />;
export const TH = ({ className = "", ...p }: ThHTMLAttributes<HTMLTableCellElement>) => <th className={`p-4 ${className}`} {...p} />;
export const TD = ({ className = "", ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={`p-4 align-middle ${className}`} {...p} />;
