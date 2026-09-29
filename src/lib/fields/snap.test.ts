import { describe, it, expect } from "vitest";
import { snapToGrid, moveBox, resizeBox, alignToOthers, gridStepFor, MIN_SIZE } from "./snap";

const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.1 };

describe("snapToGrid", () => {
  it("rounds to the nearest step", () => {
    expect(snapToGrid(0.2031, 0.0125)).toBe(0.2);
    expect(snapToGrid(0.2069, 0.0125)).toBe(0.2125);
  });
});

describe("moveBox", () => {
  it("moves, snaps the top-left corner, and keeps the size", () => {
    expect(moveBox(box, 0.031, 0.004, { grid: 0.0125 })).toEqual({ x: 0.225, y: 0.2, w: 0.2, h: 0.1 });
  });
  it("moves freely without a grid", () => {
    expect(moveBox(box, 0.031, 0.004)).toEqual({ x: 0.231, y: 0.204, w: 0.2, h: 0.1 });
  });
  it("stops at the page edges", () => {
    expect(moveBox(box, 5, -5)).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.1 });
  });
});

describe("resizeBox", () => {
  it("grows from the bottom-right corner", () => {
    expect(resizeBox(box, "se", 0.1, 0.05)).toEqual({ x: 0.2, y: 0.2, w: 0.3, h: 0.15 });
  });
  it("grows from the top-left corner, keeping the opposite corner fixed", () => {
    expect(resizeBox(box, "nw", -0.1, -0.1)).toEqual({ x: 0.1, y: 0.1, w: 0.3, h: 0.2 });
  });
  it("caps at the page edge instead of moving the box", () => {
    expect(resizeBox(box, "e", 5, 0)).toEqual({ x: 0.2, y: 0.2, w: 0.8, h: 0.1 });
    expect(resizeBox(box, "w", -5, 0)).toEqual({ x: 0, y: 0.2, w: 0.4, h: 0.1 });
  });
  it("never shrinks below the minimum size", () => {
    const r = resizeBox(box, "se", -1, -1);
    expect(r.w).toBe(MIN_SIZE);
    expect(r.h).toBe(MIN_SIZE);
    expect(r.x).toBe(0.2);
  });
  it("snaps the moving edge to the grid", () => {
    expect(resizeBox(box, "e", 0.031, 0, { grid: 0.0125 })).toEqual({ x: 0.2, y: 0.2, w: 0.225, h: 0.1 });
  });
});

describe("alignToOthers", () => {
  const other = { x: 0.5, y: 0.6, w: 0.2, h: 0.1 };
  it("snaps a near left edge and reports a vertical guide", () => {
    const r = alignToOthers({ x: 0.503, y: 0.2, w: 0.1, h: 0.05 }, [other], 0.006);
    expect(r.box.x).toBe(0.5);
    expect(r.guides.v).toContain(0.5);
  });
  it("snaps centers", () => {
    const r = alignToOthers({ x: 0.2, y: 0.628, w: 0.1, h: 0.05 }, [other], 0.006);
    expect(r.box.y).toBe(0.625);
    expect(r.guides.h).toContain(0.65);
  });
  it("leaves the box alone when nothing is close", () => {
    const b = { x: 0.1, y: 0.1, w: 0.1, h: 0.05 };
    expect(alignToOthers(b, [other], 0.006)).toEqual({ box: b, guides: { v: [], h: [] } });
  });
});

describe("gridStepFor", () => {
  it("halves the grid each time the zoom doubles", () => {
    expect(gridStepFor(100)).toBe(0.0125);
    expect(gridStepFor(150)).toBe(0.0125);
    expect(gridStepFor(200)).toBe(0.00625);
    expect(gridStepFor(400)).toBe(0.003125);
    expect(gridStepFor(50)).toBe(0.0125);
  });
});
