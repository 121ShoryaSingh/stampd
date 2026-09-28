import { describe, it, expect } from "vitest";
import { isValidBox, clampBox, toPixels, fromPixels } from "./geometry";

describe("field geometry", () => {
  it("accepts boxes inside the page and rejects ones outside", () => {
    expect(isValidBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.05 })).toBe(true);
    expect(isValidBox({ x: 0.9, y: 0.1, w: 0.2, h: 0.05 })).toBe(false);
    expect(isValidBox({ x: -0.01, y: 0.1, w: 0.2, h: 0.05 })).toBe(false);
    expect(isValidBox({ x: 0.1, y: 0.1, w: 0, h: 0.05 })).toBe(false);
    expect(isValidBox({ x: Number.NaN, y: 0, w: 0.1, h: 0.1 })).toBe(false);
  });

  it("clamps a box back onto the page keeping its size", () => {
    expect(clampBox({ x: 0.95, y: -0.1, w: 0.2, h: 0.1 })).toEqual({ x: 0.8, y: 0, w: 0.2, h: 0.1 });
  });

  it("converts between pixels and fractions", () => {
    const b = fromPixels({ left: 100, top: 50, width: 200, height: 40 }, 1000, 500);
    expect(b).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.08 });
    expect(toPixels(b, 1000, 500)).toEqual({ left: 100, top: 50, width: 200, height: 40 });
  });
});
