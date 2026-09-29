import { WizardShell } from "../_wizard/shell";
import { loadStep } from "../_wizard/load";
import { stepHref } from "../_wizard/steps";
import { Card } from "@/components/ui/card";
import { RecipientsForm } from "./recipients-form";

export default async function RecipientsStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, done } = await loadStep(id, "recipients");
  return (
    <WizardShell id={id} title={data.envelope.title} current="recipients" done={done}>
      <Card>
        <h2 className="mb-1 font-display text-2xl">Who signs, and who gets a copy?</h2>
        <p className="mb-4">Signers sign in order. CC recipients get the signed PDF.</p>
        <RecipientsForm
          envelopeId={id}
          initial={data.recipients.map((r) => ({ name: r.name, email: r.email, role: r.role, routingOrder: r.routingOrder }))}
          back={{ href: stepHref(id, "upload"), label: "Back" }}
          next={stepHref(id, "fields")}
        />
      </Card>
    </WizardShell>
  );
}
