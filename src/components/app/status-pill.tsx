const colors: Record<string, string> = {
  draft: "bg-paper",
  sent: "bg-yellow",
  completed: "bg-green",
  declined: "bg-red text-white",
  voided: "bg-ink text-paper",
  expired: "bg-pink",
  pending: "bg-paper",
  viewed: "bg-pink",
  signed: "bg-green",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`border-brutal inline-block px-2 py-0.5 font-mono text-[11px] font-bold uppercase ${colors[status] ?? "bg-paper"}`}>
      {status}
    </span>
  );
}
