"use client";

import { PdfUpload, presignEnvelopeUpload } from "@/components/app/pdf-upload";
import { finalizeUploadAction } from "./actions";

export function UploadForm({ envelopeId, hasDocument }: { envelopeId: string; hasDocument: boolean }) {
  return <PdfUpload hasDocument={hasDocument} presign={() => presignEnvelopeUpload(envelopeId)} finalize={(key, name) => finalizeUploadAction(envelopeId, key, name)} />;
}
