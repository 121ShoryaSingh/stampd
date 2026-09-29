import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireTenant } from "@/server/tenants/current";
import { getEnvelope } from "@/server/envelopes/service";
import { presignGet } from "@/server/storage/storage";
import { NotFoundError } from "@/server/errors";
import { Card } from "@/components/ui/card";
import { RecipientsForm } from "./recipients-form";
import { FieldEditor } from "@/components/app/field-editor";
import { saveFieldsAction } from "./actions";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireTenant();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getEnvelope(tenant.tenantId, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  if (data.envelope.status !== "draft" || !data.document) redirect(`/envelopes/${id}`);
  const pdfUrl = await presignGet(data.document.s3Key, 3600);
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="font-display text-4xl">{data.envelope.title}</h1>
        <Link href={`/envelopes/${id}`} className="font-bold underline">
          Back to envelope
        </Link>
      </div>
      <Card>
        <h2 className="mb-4 font-display text-2xl">1. Recipients</h2>
        <RecipientsForm
          envelopeId={id}
          initial={data.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, routingOrder: r.routingOrder }))}
        />
      </Card>
      <Card>
        <h2 className="mb-4 font-display text-2xl">2. Place fields</h2>
        <FieldEditor
          save={saveFieldsAction.bind(null, id)}
          pdfUrl={pdfUrl}
          pageSizes={data.document.pageSizes}
          recipients={data.recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role }))}
          initial={data.fields.map((f) => ({ key: f.id, recipientId: f.recipientId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, groupKey: f.groupKey, option: f.option, mark: f.mark }))}
        />
      </Card>
    </div>
  );
}
