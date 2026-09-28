import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ExternalLink, FileText, PenLine, Trash2 } from "lucide-react";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/layout";
import { StatusPill } from "@/components/app/status-pill";
import { UploadForm } from "./upload-form";
import { SendForm } from "./send-form";
import { Thumbnail, VoidButton } from "./parts";
import { deleteDraftAction } from "./actions";
import { describeEvent, relativeTime } from "./activity";

const time = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : null);

export default async function EnvelopePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { tenant } = await requireTenant();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getEnvelope(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { envelope, document, recipients, fields } = data;
  const events = await withTenant(tenant.tenantId, (tx) => listAudit(tx, id));
  const thumbUrl = document ? await presignGet(document.s3Key, 600) : null;
  const isDraft = envelope.status === "draft";
  const names = new Map(recipients.map((r) => [r.id, r.name]));
  const signers = recipients.filter((r) => r.role === "signer");
  const steps = [...new Set(signers.map((s) => s.routingOrder))].sort((a, b) => a - b);
  const ccs = recipients.filter((r) => r.role === "cc");

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={envelope.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <StatusPill status={envelope.status} />
            {envelope.sentAt && <span>Sent {time(envelope.sentAt)}</span>}
            {envelope.expiresAt && envelope.status === "sent" && <span>Expires {time(envelope.expiresAt)}</span>}
          </span>
        }
        actions={
          <>
            {isDraft && document && (
              <Link href={`/envelopes/${id}/edit`} className="border-brutal shadow-hard-sm press flex items-center gap-2 bg-yellow px-4 py-2.5 text-sm font-bold uppercase">
                <PenLine aria-hidden className="h-4 w-4" /> Edit recipients and fields
              </Link>
            )}
            {envelope.status === "sent" && <VoidButton envelopeId={id} />}
            {isDraft && (
              <form action={deleteDraftAction}>
                <input type="hidden" name="envelopeId" value={id} />
                <Button icon={<Trash2 aria-hidden className="h-4 w-4" />}>Delete draft</Button>
              </form>
            )}
          </>
        }
      />
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{error}</p>}
      {envelope.voidReason && (
        <p className="border-brutal bg-ink p-3 font-bold text-paper">Voided: {envelope.voidReason}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="rise">
            <h2 className="mb-4 flex items-center gap-2 font-display text-2xl">
              <FileText aria-hidden className="h-6 w-6" /> Document
            </h2>
            {document ? (
              <div className="flex flex-wrap items-start gap-5">
                {thumbUrl && <Thumbnail url={thumbUrl} />}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-all font-bold">{document.filename}</p>
                  <p className="font-mono text-xs">
                    {document.pageCount} pages - {fields.length} fields placed
                  </p>
                  <p className="break-all font-mono text-[10px] opacity-60">SHA-256 {document.sha256}</p>
                  <a href={`/envelopes/${id}/document`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold underline">
                    Open PDF <ExternalLink aria-hidden className="h-3 w-3" />
                  </a>
                  {isDraft && <UploadForm envelopeId={id} hasDocument />}
                </div>
              </div>
            ) : (
              <UploadForm envelopeId={id} hasDocument={false} />
            )}
          </Card>

          <Card className="rise" style={{ "--i": 1 } as React.CSSProperties}>
            <h2 className="mb-4 font-display text-2xl">Signers</h2>
            {signers.length === 0 ? (
              <p>No signers yet. {isDraft && document ? "Add them in the editor." : "Upload a PDF first."}</p>
            ) : (
              <ol className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-stretch">
                {steps.map((step, si) => (
                  <li key={step} className="min-w-0 flex-1 basis-52">
                    <p className="mb-2 font-mono text-xs font-bold uppercase">
                      Step {si + 1}
                      {si < steps.length - 1 && <span aria-hidden> -&gt;</span>}
                    </p>
                    <ul className="space-y-2">
                      {signers
                        .filter((s) => s.routingOrder === step)
                        .map((s) => (
                          <li key={s.id} className={`border-brutal p-3 ${s.status === "signed" ? "bg-green/30" : s.status === "declined" ? "bg-red/20" : "bg-paper"}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-bold">{s.name}</p>
                                <p className="truncate font-mono text-xs">{s.email}</p>
                              </div>
                              <StatusPill status={s.status} />
                            </div>
                            <p className="mt-2 font-mono text-[10px]">
                              {s.signedAt ? `Signed ${time(s.signedAt)}` : s.viewedAt ? `Opened ${time(s.viewedAt)}` : s.declineReason ? `Declined: ${s.declineReason}` : "Not opened yet"}
                            </p>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
            {ccs.length > 0 && (
              <p className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <Badge>cc</Badge> {ccs.map((c) => c.name).join(", ")}
              </p>
            )}
          </Card>

          {isDraft && document && (
            <Card className="rise" style={{ "--i": 2 } as React.CSSProperties}>
              <h2 className="mb-4 font-display text-2xl">Send</h2>
              <SendForm envelopeId={id} />
            </Card>
          )}
        </div>

        <Card className="rise h-fit" style={{ "--i": 1 } as React.CSSProperties}>
          <h2 className="mb-4 flex items-center gap-2 font-display text-2xl">
            <Activity aria-hidden className="h-6 w-6" /> Activity
          </h2>
          <ol className="relative space-y-4 border-l-[2.5px] border-ink pl-4">
            {[...events].reverse().map((e) => (
              <li key={e.seq} className="relative">
                <span aria-hidden className="absolute -left-[23px] top-1 h-3 w-3 border-2 border-ink bg-yellow" />
                <p className="font-bold">{describeEvent(e.event, (e.actorId && names.get(e.actorId)) || "Someone")}</p>
                <p className="font-mono text-[11px]" title={e.createdAt.toISOString()}>
                  {relativeTime(e.createdAt)}
                  {e.ip ? ` - ${e.ip}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
