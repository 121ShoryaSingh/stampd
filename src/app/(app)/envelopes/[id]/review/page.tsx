import Link from "next/link";
import { ExternalLink, FileText, PenLine, Trash2, Users } from "lucide-react";
import type { ReactNode } from "react";
import { WizardShell } from "../_wizard/shell";
import { loadStep } from "../_wizard/load";
import { stepHref, type StepKey } from "../_wizard/steps";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/ui/confirm";
import { presignGet } from "@/server/storage/storage";
import { listPresets } from "@/server/presets/service";
import { Thumbnail } from "../parts";
import { SendForm } from "../send-form";
import { SavePresetButton } from "../save-preset";
import { deleteDraftAction } from "../actions";

const KIND_NAMES: Record<string, [string, string]> = {
  signature: ["signature", "signatures"],
  initials: ["initials", "initials"],
  date: ["date", "dates"],
  text: ["text field", "text fields"],
  checkbox: ["checkbox", "checkboxes"],
  choice: ["question", "questions"],
};

// One summary box per earlier step, with a way back to change it.
function Summary({ id, step, title, icon, children }: { id: string; step: StepKey; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl">
          {icon} {title}
        </h2>
        <Link href={stepHref(id, step)} className="border-brutal press bg-paper px-3 py-1.5 text-sm font-bold uppercase hover:bg-yellow" aria-label={`Change ${title.toLowerCase()}`}>
          Change
        </Link>
      </div>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </Card>
  );
}

export default async function ReviewStep({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const { tenant, data, done } = await loadStep(id, "review");
  const { envelope, recipients, fields } = data;
  const document = data.document!;
  const thumbUrl = await presignGet(document.s3Key, 600);
  const signers = recipients.filter((r) => r.role === "signer").sort((a, b) => a.routingOrder - b.routingOrder);
  const ccs = recipients.filter((r) => r.role === "cc");
  const canSavePreset = tenant.role === "admin";
  const presets = canSavePreset ? (await listPresets(tenant.tenantId)).map((p) => ({ id: p.id, name: p.name })) : [];
  // Questions count once, however many answer boxes they have.
  const tally = (recipientId: string) => {
    const mine = fields.filter((f) => f.recipientId === recipientId);
    const counts = new Map<string, number>();
    const questions = new Set<string>();
    for (const f of mine) {
      if (f.type === "choice") {
        if (f.groupKey && questions.has(f.groupKey)) continue;
        if (f.groupKey) questions.add(f.groupKey);
      }
      counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    }
    return [...counts].map(([t, n]) => `${n} ${KIND_NAMES[t][n === 1 ? 0 : 1]}`).join(", ");
  };

  return (
    <WizardShell id={id} title={envelope.title} current="review" done={done}>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{error}</p>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Summary id={id} step="upload" title="Document" icon={<FileText aria-hidden className="h-5 w-5" />}>
          <div className="flex items-start gap-4">
            <Thumbnail url={thumbUrl} width={90} />
            <div className="min-w-0 space-y-1">
              <p className="break-all font-bold">{document.filename}</p>
              <p className="font-mono text-xs">{document.pageCount} pages</p>
              <a href={`/envelopes/${id}/document`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold underline">
                Open PDF <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
            </div>
          </div>
        </Summary>
        <Summary id={id} step="recipients" title="Recipients" icon={<Users aria-hidden className="h-5 w-5" />}>
          <ol className="space-y-1">
            {signers.map((s) => (
              <li key={s.id} className="min-w-0">
                <span className="font-mono text-xs font-bold">#{s.routingOrder}</span> <span className="font-bold">{s.name}</span>
                <span className="block truncate font-mono text-xs">{s.email}</span>
              </li>
            ))}
          </ol>
          {ccs.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge>cc</Badge> {ccs.map((c) => c.name).join(", ")}
            </p>
          )}
        </Summary>
        <Summary id={id} step="fields" title="Fields" icon={<PenLine aria-hidden className="h-5 w-5" />}>
          <ul className="space-y-1">
            {signers.map((s) => (
              <li key={s.id}>
                <span className="font-bold">{s.name}:</span> {tally(s.id)}
              </li>
            ))}
          </ul>
        </Summary>
      </div>

      <Card>
        <h2 className="mb-4 font-display text-2xl">Send</h2>
        <SendForm envelopeId={id} back={{ href: stepHref(id, "fields"), label: "Back" }} />
      </Card>

      <div className="flex flex-wrap gap-3">
        {canSavePreset && <SavePresetButton envelopeId={id} title={envelope.title} presets={presets} />}
        <form action={deleteDraftAction}>
          <input type="hidden" name="envelopeId" value={id} />
          <ConfirmSubmit
            icon={<Trash2 aria-hidden className="h-4 w-4" />}
            confirm={{ title: "Delete this draft?", message: `"${envelope.title}", its PDF, recipients and fields are removed. This cannot be undone.`, confirmLabel: "Delete draft", tone: "danger" }}
          >
            Delete draft
          </ConfirmSubmit>
        </form>
      </div>
    </WizardShell>
  );
}
