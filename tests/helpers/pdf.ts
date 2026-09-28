import { PDFDocument } from "pdf-lib";

export async function makePdf(pages = 1, size: [number, number] = [612, 792]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage(size).drawText(`Page ${i + 1}`, { x: 50, y: 700 });
  return doc.save();
}
