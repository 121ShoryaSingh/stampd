"use client";

import { useEffect, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Ban } from "lucide-react";
import { PdfCanvas } from "@/components/pdf/pdf-canvas";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/fields";
import { voidAction } from "./actions";

export function Thumbnail({ url, width = 150 }: { url: string; width?: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const d = await pdfjs.getDocument({ url }).promise;
      if (alive) setDoc(d);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="border-brutal shadow-hard-sm shrink-0 bg-paper" style={{ width }} aria-hidden>
      {doc ? <PdfCanvas doc={doc} pageNumber={1} width={width - 5} /> : <div className="shimmer bg-ink/10" style={{ height: width * 1.3 }} />}
    </div>
  );
}

export function VoidButton({ envelopeId }: { envelopeId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" icon={<Ban aria-hidden className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Void envelope
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Void envelope">
        <form action={voidAction} className="space-y-4">
          <input type="hidden" name="envelopeId" value={envelopeId} />
          <p>Signers will no longer be able to sign. This cannot be undone.</p>
          <Textarea label="Reason for voiding" name="reason" required maxLength={500} rows={3} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger">Void</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
