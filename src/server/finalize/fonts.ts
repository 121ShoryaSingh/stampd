import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkitNs from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

// The ESM build exports a default object; the CJS build exports the functions directly.
const fontkit = ((fontkitNs as unknown as { default?: typeof fontkitNs }).default ?? fontkitNs) as typeof fontkitNs;

// DejaVu Sans: Latin, Greek and Cyrillic. pdf-lib cannot shape scripts such as Arabic or Devanagari.
const FONT_DIR = () => join(process.cwd(), "node_modules", "dejavu-fonts-ttf", "ttf");

let loaded: { regular: Uint8Array; bold: Uint8Array; covers: (cp: number) => boolean } | undefined;

function fonts() {
  if (!loaded) {
    const regular = readFileSync(join(FONT_DIR(), "DejaVuSans.ttf"));
    const bold = readFileSync(join(FONT_DIR(), "DejaVuSans-Bold.ttf"));
    const faces = [fontkit.create(regular), fontkit.create(bold)];
    loaded = { regular, bold, covers: (cp) => faces.every((f) => f.hasGlyphForCodePoint(cp)) };
  }
  return loaded;
}

const isControl = (cp: number) => cp < 0x20 || (cp >= 0x7f && cp < 0xa0);

// Characters the PDF font cannot draw, for input validation.
export function unsupportedChars(text: string): string[] {
  const bad = new Set<string>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!isControl(cp) && !/\s/.test(ch) && !fonts().covers(cp)) bad.add(ch);
  }
  return [...bad];
}

// Text safe to draw: control characters become spaces, missing glyphs become "?".
export function printable(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += isControl(cp) ? " " : fonts().covers(cp) ? ch : "?";
  }
  return out;
}

export async function embedFonts(doc: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont }> {
  doc.registerFontkit(fontkit);
  const f = fonts();
  return { regular: await doc.embedFont(f.regular, { subset: true }), bold: await doc.embedFont(f.bold, { subset: true }) };
}
