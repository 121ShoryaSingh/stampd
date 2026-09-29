export type Box = { x: number; y: number; w: number; h: number };
export type FieldKind = "signature" | "initials" | "date" | "text" | "checkbox" | "choice";

// Default sizes as fractions of a US Letter page.
export const DEFAULT_FIELD_SIZE: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 0.28, h: 0.06 },
  initials: { w: 0.1, h: 0.05 },
  date: { w: 0.18, h: 0.035 },
  text: { w: 0.25, h: 0.035 },
  checkbox: { w: 0.018, h: 0.014 },
  choice: { w: 0.12, h: 0.03 },
};

const EPS = 1e-9;
// Matches MIN_SIZE in snap.ts; blocks invisible fields.
const MIN_FIELD = 0.01 - EPS;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function isValidBox(b: Box): boolean {
  if (![b.x, b.y, b.w, b.h].every(Number.isFinite)) return false;
  return b.x >= 0 && b.y >= 0 && b.w >= MIN_FIELD && b.h >= MIN_FIELD && b.x + b.w <= 1 + EPS && b.y + b.h <= 1 + EPS;
}

export function clampBox(b: Box): Box {
  const w = Math.min(Math.max(b.w, 0.01), 1);
  const h = Math.min(Math.max(b.h, 0.01), 1);
  return { x: round(Math.min(Math.max(b.x, 0), 1 - w)), y: round(Math.min(Math.max(b.y, 0), 1 - h)), w: round(w), h: round(h) };
}

export function toPixels(b: Box, pageW: number, pageH: number) {
  return { left: round(b.x * pageW), top: round(b.y * pageH), width: round(b.w * pageW), height: round(b.h * pageH) };
}

export function fromPixels(px: { left: number; top: number; width: number; height: number }, pageW: number, pageH: number): Box {
  return { x: round(px.left / pageW), y: round(px.top / pageH), w: round(px.width / pageW), h: round(px.height / pageH) };
}
