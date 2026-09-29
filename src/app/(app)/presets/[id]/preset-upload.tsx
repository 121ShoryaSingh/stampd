"use client";

import { PdfUpload } from "@/components/app/pdf-upload";
import { finalizePresetUploadAction, presetUploadUrlAction } from "../actions";

export function PresetUpload({ presetId, hasDocument }: { presetId: string; hasDocument: boolean }) {
  return <PdfUpload hasDocument={hasDocument} presign={() => presetUploadUrlAction(presetId)} finalize={(key, name) => finalizePresetUploadAction(presetId, key, name)} />;
}
