import { degrees, rgb, type PDFDocument, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { FieldType } from "@/server/db/types";
import { fieldRect, pageFrame, toUser, type PageFrame } from "./geometry";
import { printable } from "./fonts";

export type StampField = { type: FieldType; page: number; x: number; y: number; w: number; h: number; value: string | null; image?: PDFImage | null };
type Rect = ReturnType<typeof fieldRect>;

const INK = rgb(0.05, 0.1, 0.45);
const LINE = 1.2;
const MAX_SIZE = 14;
const MIN_SIZE = 4;

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= maxW) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the box is split by characters.
      line = "";
      for (const ch of word) {
        if (line && font.widthOfTextAtSize(line + ch, size) > maxW) {
          lines.push(line);
          line = "";
        }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Largest font size (max 14 pt) at which the wrapped text fits the box; cut with an ellipsis below 4 pt.
export function layoutText(text: string, font: PDFFont, w: number, h: number) {
  const pad = Math.min(2, w * 0.05, h * 0.1);
  const maxW = Math.max(1, w - 2 * pad);
  const maxH = Math.max(1, h - 2 * pad);
  for (let size = Math.min(MAX_SIZE, maxH / LINE); size >= MIN_SIZE; size -= 0.25) {
    const lines = wrap(text, font, size, maxW);
    if (lines.length * size * LINE <= maxH) return { size, lines, pad };
  }
  const size = MIN_SIZE;
  const all = wrap(text, font, size, maxW);
  const lines = all.slice(0, Math.max(1, Math.floor(maxH / (size * LINE))));
  if (lines.length < all.length) {
    let last = lines[lines.length - 1];
    while (last && font.widthOfTextAtSize(`${last}…`, size) > maxW) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  return { size, lines, pad };
}

function drawText(page: PDFPage, frame: PageFrame, r: Rect, text: string, font: PDFFont) {
  const { size, lines, pad } = layoutText(text, font, r.w, r.h);
  const lh = size * LINE;
  const ascent = font.heightAtSize(size, { descender: false });
  const full = font.heightAtSize(size);
  const top = r.v + (r.h - lines.length * lh) / 2;
  lines.forEach((line, i) => {
    const p = toUser(frame, r.u + pad, top + i * lh + (lh - full) / 2 + ascent);
    page.drawText(line, { x: p.x, y: p.y, size, font, color: INK, rotate: degrees(frame.rotation) });
  });
}

// Scaled to fit the box, centered, upright as the viewer sees the page.
function drawImage(page: PDFPage, frame: PageFrame, r: Rect, img: PDFImage) {
  const s = Math.min(r.w / img.width, r.h / img.height);
  const w = img.width * s;
  const h = img.height * s;
  const p = toUser(frame, r.u + (r.w - w) / 2, r.v + (r.h + h) / 2);
  page.drawImage(img, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(frame.rotation) });
}

function drawCheck(page: PDFPage, frame: PageFrame, r: Rect) {
  const pts = [
    [0.2, 0.55],
    [0.42, 0.78],
    [0.8, 0.22],
  ].map(([a, b]) => toUser(frame, r.u + a * r.w, r.v + b * r.h));
  const thickness = Math.max(1, Math.min(r.w, r.h) * 0.12);
  page.drawLine({ start: pts[0], end: pts[1], thickness, color: INK });
  page.drawLine({ start: pts[1], end: pts[2], thickness, color: INK });
}

// Draws every filled field onto the original pages.
export function stampFields(doc: PDFDocument, fields: StampField[], font: PDFFont) {
  const pages = doc.getPages();
  for (const f of fields) {
    const page = pages[f.page - 1];
    if (!page) throw new Error(`A field is on page ${f.page}, but the document has ${pages.length} pages`);
    const frame = pageFrame(page);
    const r = fieldRect(frame, f);
    if (f.type === "signature" || f.type === "initials") {
      if (f.image) drawImage(page, frame, r, f.image);
    } else if (f.type === "checkbox") {
      if (f.value === "true") drawCheck(page, frame, r);
    } else if (f.value) {
      drawText(page, frame, r, printable(f.value), font);
    }
  }
}
