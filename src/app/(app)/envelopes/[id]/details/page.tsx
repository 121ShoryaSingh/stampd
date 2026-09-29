import { WizardShell } from "../_wizard/shell";
import { loadStep } from "../_wizard/load";
import { Card } from "@/components/ui/card";
import { DetailsForm } from "./details-form";

export default async function DetailsStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, done } = await loadStep(id, "details");
  return (
    <WizardShell id={id} title={data.envelope.title} current="details" done={done}>
      <Card>
        <h2 className="mb-4 font-display text-2xl">What is this envelope?</h2>
        <DetailsForm envelopeId={id} title={data.envelope.title} />
      </Card>
    </WizardShell>
  );
}
