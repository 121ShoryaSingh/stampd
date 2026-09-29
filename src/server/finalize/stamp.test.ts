import { describe, it, expect } from "vitest";
import { PDFDocument, degrees } from "pdf-lib";
import { visibleText } from "../../../tests/helpers/pdfjs";
import { embedFonts, printable, unsupportedChars } from "./fonts";
import { fieldRect, pageFrame, toUser } from "./geometry";
import { layoutText, stampFields } from "./stamp";

describe("toUser", () => {
  const box = { x: 50, y: 60, width: 400, height: 500 };
  it("maps the visible corners for every rotation", () => {
    // Visible top-left corner of the page for each rotation.
    expect(toUser({ box, rotation: 0 }, 0, 0)).toEqual({ x: 50, y: 560 });
    expect(toUser({ box, rotation: 90 }, 0, 0)).toEqual({ x: 50, y: 60 });
    expect(toUser({ box, rotation: 180 }, 0, 0)).toEqual({ x: 450, y: 60 });
    expect(toUser({ box, rotation: 270 }, 0, 0)).toEqual({ x: 450, y: 560 });
    // Visible bottom-right (visible size is 500x400 when turned).
    expect(toUser({ box, rotation: 90 }, 500, 400)).toEqual({ x: 450, y: 560 });
    expect(toUser({ box, rotation: 270 }, 500, 400)).toEqual({ x: 50, y: 60 });
  });
});

describe("stampFields", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    it(`puts text inside its field, upright, on a page rotated ${rotation} with a crop box`, async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([612, 792]);
      page.setCropBox(50, 60, 400, 500);
      page.setRotation(degrees(rotation));
      const { regular } = await embedFonts(doc);
      const field = { type: "text" as const, page: 1, x: 0.2, y: 0.3, w: 0.5, h: 0.06, value: "Acme Ltd" };
      stampFields(doc, [field], regular);
      const bytes = await doc.save();

      const [t] = (await visibleText(bytes)).filter((i) => i.str.includes("Acme"));
      const frame = pageFrame((await PDFDocument.load(bytes)).getPage(0));
      expect([t.width, t.height]).toEqual([frame.width, frame.height]);
      const r = fieldRect(frame, field);
      expect(t.u).toBeGreaterThanOrEqual(r.u);
      expect(t.u).toBeLessThan(r.u + 5);
      expect(t.v).toBeGreaterThan(r.v);
      expect(t.v).toBeLessThanOrEqual(r.v + r.h);
      // Upright for the reader: baseline runs to the right, glyphs point up.
      expect(t.m[0]).toBeGreaterThan(0);
      expect(Math.abs(t.m[1])).toBeLessThan(1e-6);
      expect(t.m[3]).toBeLessThan(0);
    });
  }

  it("skips empty values and unticked checkboxes, and fails on a missing page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const { regular } = await embedFonts(doc);
    stampFields(doc, [{ type: "text", page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.05, value: null }, { type: "checkbox", page: 1, x: 0.1, y: 0.2, w: 0.03, h: 0.03, value: "false" }], regular);
    expect(await visibleText(await doc.save())).toEqual([]);
    expect(() => stampFields(doc, [{ type: "date", page: 3, x: 0, y: 0, w: 0.1, h: 0.1, value: "2026-01-01" }], regular)).toThrow(/page 3/);
  });
  it("prints the Yes/No answer of a choice field", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const { regular } = await embedFonts(doc);
    stampFields(doc, [{ type: "choice", page: 1, x: 0.1, y: 0.1, w: 0.12, h: 0.03, value: "yes" }, { type: "choice", page: 1, x: 0.1, y: 0.3, w: 0.12, h: 0.03, value: "no" }], regular);
    expect((await visibleText(await doc.save())).map((t) => t.str)).toEqual(["Yes", "No"]);
  });
});

describe("layoutText", () => {
  it("shrinks and wraps long text to fit, and cuts what never fits", async () => {
    const doc = await PDFDocument.create();
    const { regular } = await embedFonts(doc);
    expect(layoutText("Short", regular, 200, 20).lines).toEqual(["Short"]);
    const wrapped = layoutText("one two three four five six seven eight nine ten", regular, 60, 60);
    expect(wrapped.lines.length).toBeGreaterThan(1);
    for (const l of wrapped.lines) expect(regular.widthOfTextAtSize(l, wrapped.size)).toBeLessThanOrEqual(60);
    const cut = layoutText("x".repeat(500), regular, 40, 8);
    expect(cut.size).toBe(4);
    expect(cut.lines.at(-1)!.endsWith("…")).toBe(true);
  });
});

describe("fonts", () => {
  it("draws Latin, Greek and Cyrillic, and flags other scripts", () => {
    expect(unsupportedChars("Zoë Ωmega Иван, O'Brien & Co.")).toEqual([]);
    expect(unsupportedChars("李 明 नमस्ते")).toEqual(expect.arrayContaining(["李", "明", "न"]));
    expect(printable("Li 李\u0007x")).toBe("Li ? x");
  });
});
