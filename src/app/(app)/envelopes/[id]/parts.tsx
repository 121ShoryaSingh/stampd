"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfjs } from "@/lib/pdfjs";
import { Ban, Send } from "lucide-react";
import { PdfCanvas } from "@/components/pdf/pdf-canvas";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { resendAction, voidAction } from "./actions";

export function Thumbnail({ url, width = 150 }: { url: string; width?: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const pdfjs = await loadPdfjs();
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

export function ResendButton({ envelopeId, recipientId, email }: { envelopeId: string; recipientId: string; email: string }) {
  const [pending, start] = useTransition();
  const { show } = useToast();
  return (
    <Button
      size="sm"
      loading={pending}
      icon={<Send aria-hidden className="h-3 w-3" />}
      aria-label={`Resend email to ${email}`}
      onClick={() =>
        start(async () => {
          const res = await resendAction(envelopeId, recipientId);
          show(res.error ?? `New link emailed to ${email}`, res.error ? "red" : "green");
        })
      }
    >
      Resend
    </Button>
  );
}

// Re-renders the page every few seconds for a while, e.g. until the signed PDF is ready.
export function AutoRefresh({ everyMs = 4000, forMs = 300_000 }: { everyMs?: number; forMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > forMs) clearInterval(t);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(t);
  }, [router, everyMs, forMs]);
  return null;
}
