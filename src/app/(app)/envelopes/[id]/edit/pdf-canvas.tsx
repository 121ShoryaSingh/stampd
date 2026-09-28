"use client";

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

// Renders one PDF page at the given CSS width.
export function PdfCanvas({ doc, pageNumber, width }: { doc: PDFDocumentProxy; pageNumber: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | undefined;
    (async () => {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * dpr });
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${(viewport.height / viewport.width) * width}px`;
      const render = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
      task = render;
      await render.promise.catch(() => {});
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, width]);
  return <canvas ref={ref} className="block" />;
}
