// pdf.js for the browser. The legacy build carries polyfills (e.g. Map.getOrInsertComputed),
// so previews also work in browsers a few versions behind; the worker comes from the same build.
export async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"; // copied from the legacy build on install
  return pdfjs;
}
