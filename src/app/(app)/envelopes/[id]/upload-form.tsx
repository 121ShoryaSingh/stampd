"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { finalizeUploadAction } from "./actions";

const MAX = 26_214_400;

export function UploadForm({ envelopeId, hasDocument }: { envelopeId: string; hasDocument: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.type && file.type !== "application/pdf") return setError("Choose a PDF file");
    if (file.size > MAX) return setError("PDFs can be at most 25 MB");
    setBusy(true);
    try {
      const pre = await fetch("/api/uploads/presign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ envelopeId }),
      });
      const body = await pre.json();
      if (!pre.ok) throw new Error(body.error ?? "Upload failed");
      const up = await fetch(body.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: file });
      if (!up.ok) throw new Error("Upload was rejected by storage");
      const res = await finalizeUploadAction(envelopeId, body.key, file.name);
      if (res.error) throw new Error(res.error);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <label className="border-brutal shadow-hard-sm block cursor-pointer bg-yellow p-6 text-center font-bold">
        {busy ? "Uploading..." : hasDocument ? "Replace PDF" : "Choose a PDF to upload"}
        <input
          type="file"
          accept="application/pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => onFile(e.target.files?.[0])}
          data-testid="pdf-input"
        />
      </label>
      {error && <p role="alert" className="border-brutal bg-red p-3 font-bold text-ink">{error}</p>}
    </div>
  );
}
