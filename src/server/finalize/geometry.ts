import type { PDFPage } from "pdf-lib";

export type Rotation = 0 | 90 | 180 | 270;
export type Box = { x: number; y: number; width: number; height: number };

// What the viewer shows: the crop box turned clockwise by /Rotate (as pdf.js and the editor do).
export type PageFrame = { box: Box; rotation: Rotation; width: number; height: number };

export function pageFrame(page: PDFPage): PageFrame {
  const box = page.getCropBox();
  const rotation = ((((Math.round(page.getRotation().angle / 90) * 90) % 360) + 360) % 360) as Rotation;
  const turned = rotation === 90 || rotation === 270;
  return { box, rotation, width: turned ? box.height : box.width, height: turned ? box.width : box.height };
}

// A visible point (u to the right, v down, in points from the visible top-left) in PDF user space.
export function toUser(f: Pick<PageFrame, "box" | "rotation">, u: number, v: number): { x: number; y: number } {
  const { x, y, width: w, height: h } = f.box;
  switch (f.rotation) {
    case 90:
      return { x: x + v, y: y + u };
    case 180:
      return { x: x + w - u, y: y + v };
    case 270:
      return { x: x + w - v, y: y + h - u };
    default:
      return { x: x + u, y: y + h - v };
  }
}

// A field rectangle (fractions 0..1 of the visible page) in visible points.
export function fieldRect(f: PageFrame, r: { x: number; y: number; w: number; h: number }) {
  return { u: r.x * f.width, v: r.y * f.height, w: r.w * f.width, h: r.h * f.height };
}
