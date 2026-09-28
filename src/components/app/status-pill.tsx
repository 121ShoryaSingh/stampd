import { Ban, CheckCircle2, CircleDashed, Clock, Eye, FileEdit, Hourglass, Send, XCircle } from "lucide-react";
import type { ComponentType } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const STYLES: Record<string, { tone: BadgeTone; Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }> }> = {
  draft: { tone: "paper", Icon: FileEdit },
  sent: { tone: "yellow", Icon: Send },
  completed: { tone: "green", Icon: CheckCircle2 },
  declined: { tone: "red", Icon: XCircle },
  voided: { tone: "ink", Icon: Ban },
  expired: { tone: "pink", Icon: Hourglass },
  pending: { tone: "paper", Icon: CircleDashed },
  viewed: { tone: "pink", Icon: Eye },
  signed: { tone: "green", Icon: CheckCircle2 },
};

// Text plus icon, never color alone.
export function StatusPill({ status }: { status: string }) {
  const s = STYLES[status] ?? { tone: "paper" as const, Icon: Clock };
  return (
    <Badge tone={s.tone} icon={<s.Icon aria-hidden className="h-3 w-3" />}>
      {status}
    </Badge>
  );
}
