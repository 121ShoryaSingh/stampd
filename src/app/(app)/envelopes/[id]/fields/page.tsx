import { WizardShell } from "../_wizard/shell";
import { loadStep } from "../_wizard/load";
import { stepHref } from "../_wizard/steps";
import { saveFieldsAction } from "../_wizard/actions";
import { Card } from "@/components/ui/card";
import { FieldEditor } from "@/components/app/field-editor";
import { presignGet } from "@/server/storage/storage";

export default async function FieldsStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, done } = await loadStep(id, "fields");
  // Reachable only with a PDF and signers (see progress()).
  const document = data.document!;
  const pdfUrl = await presignGet(document.s3Key, 3600);
  return (
    <WizardShell id={id} title={data.envelope.title} current="fields" done={done} wide>
      <Card>
        <h2 className="mb-1 font-display text-2xl">Place the fields</h2>
        <p className="mb-4">Every signer needs at least one signature field.</p>
        <FieldEditor
          save={saveFieldsAction.bind(null, id)}
          pdfUrl={pdfUrl}
          pageSizes={document.pageSizes}
          recipients={data.recipients.map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role }))}
          initial={data.fields.map((f) => ({ key: f.id, recipientId: f.recipientId, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, groupKey: f.groupKey, option: f.option, mark: f.mark }))}
          wizard={{ back: { href: stepHref(id, "recipients"), label: "Back" }, next: stepHref(id, "review") }}
        />
      </Card>
    </WizardShell>
  );
}
