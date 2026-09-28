import "server-only";
import { PDFDocument, EncryptedPDFError } from "pdf-lib";
import type { PageSize } from "@/server/db/types";
import { ValidationError } from "@/server/errors";

export const MAX_PAGES = 200;

export async function inspectPdf(bytes: Uint8Array): Promise<{ pageCount: number; pageSizes: PageSize[] }> {
  const invalid = () => new ValidationError("This file is not a valid PDF");
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw invalid();
  // pdf-lib is lenient with cut-off files, so require the end-of-file marker.
  if (!new TextDecoder().decode(bytes.slice(-1024)).includes("%%EOF")) throw invalid();
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (e instanceof EncryptedPDFError) throw new ValidationError("Password-protected PDFs are not supported");
    throw invalid();
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new ValidationError("This file is not a valid PDF (no pages)");
  if (pages.length > MAX_PAGES) throw new ValidationError(`PDFs can have at most ${MAX_PAGES} pages`);
  return { pageCount: pages.length, pageSizes: pages.map((p) => ({ w: p.getWidth(), h: p.getHeight() })) };
}
