// Reads a PDF the way the editor shows it (pdf.js viewport at scale 1): text positions in visible points.
export async function visibleText(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const out: { page: number; str: string; u: number; v: number; m: number[]; width: number; height: number }[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    for (const item of (await page.getTextContent()).items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const m = pdfjs.Util.transform(vp.transform, item.transform);
      out.push({ page: n, str: item.str, u: m[4], v: m[5], m, width: vp.width, height: vp.height });
    }
  }
  await task.destroy();
  return out;
}
