import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/app/status-pill";
import { UploadForm } from "./upload-form";
import { SendForm } from "./send-form";
import { deleteDraftAction, voidAction } from "./actions";

export default async function EnvelopePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tenant } = await requireTenant();
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getEnvelope(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { envelope, document, recipients, fields } = data;
  const events = await withTenant(tenant.tenantId, (tx) => listAudit(tx, id));
  const docUrl = document ? await presignGet(document.s3Key) : null;
  const isDraft = envelope.status === "draft";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="font-display text-5xl">{envelope.title}</h1>
        <StatusPill status={envelope.status} />
      </div>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-white">{error}</p>}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-display text-2xl">Document</h2>
          {document ? (
            <p className="mb-4">
              <a href={docUrl!} target="_blank" rel="noreferrer" className="font-bold underline">
                {document.filename}
              </a>{" "}
              <span className="font-mono text-xs">({document.pageCount} pages)</span>
            </p>
          ) : (
            <p className="mb-4">No PDF yet.</p>
          )}
          {isDraft && <UploadForm envelopeId={id} hasDocument={!!document} />}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-2xl">Recipients</h2>
            {isDraft && document && (
              <Link href={`/envelopes/${id}/edit`} className="border-brutal shadow-hard-sm bg-yellow px-3 py-1.5 text-sm font-bold uppercase">
                Edit recipients and fields
              </Link>
            )}
          </div>
          {recipients.length === 0 ? (
            <p>None yet.</p>
          ) : (
            <ul className="space-y-2">
              {recipients.map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b border-ink/20 pb-2">
                  <span>
                    <b>{r.name}</b>{" "}
                    <span className="font-mono text-xs">
                      {r.email} - {r.role} - step {r.routingOrder}
                    </span>
                  </span>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 font-mono text-xs">{fields.length} fields placed</p>
        </Card>
      </div>

      {isDraft && document && (
        <Card>
          <h2 className="mb-4 font-display text-2xl">Send</h2>
          <SendForm envelopeId={id} />
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-display text-2xl">Activity</h2>
        <ol className="space-y-1 font-mono text-xs">
          {events.map((e) => (
            <li key={e.seq}>
              <span className="font-bold uppercase">{e.event}</span> - {e.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex gap-3">
        {isDraft && (
          <form action={deleteDraftAction}>
            <input type="hidden" name="envelopeId" value={id} />
            <Button>Delete draft</Button>
          </form>
        )}
        {envelope.status === "sent" && (
          <form action={voidAction} className="flex gap-2">
            <input type="hidden" name="envelopeId" value={id} />
            <input name="reason" required placeholder="Reason for voiding" aria-label="Reason for voiding" className="border-brutal px-3 py-2" />
            <Button>Void envelope</Button>
          </form>
        )}
      </div>
    </div>
  );
}
