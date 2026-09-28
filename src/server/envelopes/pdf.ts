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
  let pageSizes: PageSize[];
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    // Visible size: crop box, with width/height swapped for 90/270 degree rotation.
    pageSizes = doc.getPages().map((p) => {
      const box = p.getCropBox();
      const rotate = (((p.getRotation().angle % 360) + 360) % 360) as number;
      const turned = rotate === 90 || rotate === 270;
      if (!(box.width > 0 && box.height > 0)) throw invalid();
      return { w: turned ? box.height : box.width, h: turned ? box.width : box.height, rotate };
    });
  } catch (e) {
    if (e instanceof EncryptedPDFError) throw new ValidationError("Password-protected PDFs are not supported");
    if (e instanceof ValidationError) throw e;
    throw invalid();
  }
  if (pageSizes.length === 0) throw new ValidationError("This file is not a valid PDF (no pages)");
  if (pageSizes.length > MAX_PAGES) throw new ValidationError(`PDFs can have at most ${MAX_PAGES} pages`);
  return { pageCount: pageSizes.length, pageSizes };
}
