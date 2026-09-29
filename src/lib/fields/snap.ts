import type { Box } from "./geometry";

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export type Guides = { v: number[]; h: number[] };

// Smallest field side, as a fraction of the page.
// Small enough for a printed tick box (about 3 pt).
export const MIN_SIZE = 0.005;
// Fine grid: 80 cells across; a bold line every 8 cells.
export const GRID_STEP = 0.0125;
export const GRID_MAJOR_EVERY = 8;

// On-screen size of the finest grid cell, in CSS pixels at the editor's 760 px base width.
const FINEST_CELL_PX = 6;
const BASE_PAGE_PX = 760;

// The finest useful grid at every zoom: GRID_STEP split in halves until a cell is at most ~6 px on screen,
// so zooming in always adds more, smaller cells (and fields snap to them). Halving keeps every line on the
// bolder 100% lines.
export function gridStepFor(zoom: number): number {
  const cellPx = (GRID_STEP * BASE_PAGE_PX * zoom) / 100;
  return GRID_STEP / 2 ** Math.max(0, Math.ceil(Math.log2(cellPx / FINEST_CELL_PX)));
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function snapToGrid(v: number, step: number): number {
  return r6(Math.round(v / step) * step);
}

export function moveBox(b: Box, dx: number, dy: number, opts: { grid?: number } = {}): Box {
  let x = b.x + dx;
  let y = b.y + dy;
  if (opts.grid) {
    x = snapToGrid(x, opts.grid);
    y = snapToGrid(y, opts.grid);
  }
  return { x: r6(clamp(x, 0, 1 - b.w)), y: r6(clamp(y, 0, 1 - b.h)), w: b.w, h: b.h };
}

// The edge(s) named by the handle move; the opposite edges stay put.
export function resizeBox(b: Box, handle: Handle, dx: number, dy: number, opts: { grid?: number } = {}): Box {
  const snap = (v: number) => (opts.grid ? snapToGrid(v, opts.grid) : v);
  let left = b.x;
  let right = b.x + b.w;
  let top = b.y;
  let bottom = b.y + b.h;
  if (handle.includes("e")) right = clamp(snap(right + dx), left + MIN_SIZE, 1);
  if (handle.includes("w")) left = clamp(snap(left + dx), 0, right - MIN_SIZE);
  if (handle.includes("s")) bottom = clamp(snap(bottom + dy), top + MIN_SIZE, 1);
  if (handle.includes("n")) top = clamp(snap(top + dy), 0, bottom - MIN_SIZE);
  return { x: r6(left), y: r6(top), w: r6(right - left), h: r6(bottom - top) };
}

const xs = (b: Box) => [b.x, b.x + b.w / 2, b.x + b.w];
const ys = (b: Box) => [b.y, b.y + b.h / 2, b.y + b.h];

function bestShift(lines: number[], targets: number[], threshold: number): number | null {
  let best: number | null = null;
  for (const l of lines) {
    for (const t of targets) {
      const d = t - l;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  return best;
}

// Snaps edges/centers to nearby fields and returns the guide lines that now line up.
export function alignToOthers(b: Box, others: Box[], threshold: number): { box: Box; guides: Guides } {
  const tx = others.flatMap(xs);
  const ty = others.flatMap(ys);
  const sx = bestShift(xs(b), tx, threshold);
  const sy = bestShift(ys(b), ty, threshold);
  const box = { ...b, x: r6(b.x + (sx ?? 0)), y: r6(b.y + (sy ?? 0)) };
  const hits = (lines: number[], targets: number[]) => [...new Set(targets.filter((t) => lines.some((l) => Math.abs(l - t) < 1e-6)).map(r6))];
  return { box: sx === null && sy === null ? b : box, guides: { v: sx === null ? [] : hits(xs(box), tx), h: sy === null ? [] : hits(ys(box), ty) } };
}
