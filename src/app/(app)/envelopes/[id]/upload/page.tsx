import { ExternalLink } from "lucide-react";
import { WizardShell } from "../_wizard/shell";
import { loadStep } from "../_wizard/load";
import { stepHref } from "../_wizard/steps";
import { Card } from "@/components/ui/card";
import { NextLink, WizardNav } from "@/components/app/wizard-nav";
import { presignGet } from "@/server/storage/storage";
import { Thumbnail } from "../parts";
import { UploadForm } from "../upload-form";

export default async function UploadStep({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data, done } = await loadStep(id, "upload");
  const { document } = data;
  const thumbUrl = document ? await presignGet(document.s3Key, 600) : null;
  return (
    <WizardShell id={id} title={data.envelope.title} current="upload" done={done}>
      <Card>
        <h2 className="mb-4 font-display text-2xl">{document ? "Your PDF" : "Upload the PDF to sign"}</h2>
        {document ? (
          <div className="flex flex-wrap items-start gap-5">
            {thumbUrl && <Thumbnail url={thumbUrl} />}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="break-all font-bold">{document.filename}</p>
              <p className="font-mono text-xs">{document.pageCount} pages</p>
              <a href={`/envelopes/${id}/document`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold underline">
                Open PDF <ExternalLink aria-hidden className="h-3 w-3" />
              </a>
              <UploadForm envelopeId={id} hasDocument />
            </div>
          </div>
        ) : (
          <UploadForm envelopeId={id} hasDocument={false} />
        )}
      </Card>
      <WizardNav
        back={{ href: stepHref(id, "details"), label: "Back" }}
        next={document ? <NextLink href={stepHref(id, "recipients")} label="Continue" /> : <p className="font-bold">Upload a PDF to continue</p>}
      />
    </WizardShell>
  );
}
