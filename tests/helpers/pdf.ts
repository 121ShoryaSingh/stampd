import { PDFDocument, PDFName, degrees } from "pdf-lib";

export async function makePdf(pages = 1, size: [number, number] = [612, 792]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return doc.save();
}

// Page 1: portrait Letter rotated 90 (shows landscape). Page 2: Letter cropped to 300x400.
export async function rotatedAndCroppedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).setRotation(degrees(90));
  doc.addPage([612, 792]).setCropBox(50, 50, 300, 400);
  return doc.save();
}

// Loads fine, but the only page has no MediaBox anywhere in its tree.
export async function brokenPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.node.delete(PDFName.of("MediaBox"));
  return doc.save();
}
