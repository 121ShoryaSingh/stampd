import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { visibleText } from "../../../tests/helpers/pdfjs";
import { embedFonts } from "./fonts";
import { appendCertificate, type CertificateData } from "./certificate";
import { sampleCertificate } from "../../../tests/helpers/certificate";

async function render(d: CertificateData) {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);
  const pages = appendCertificate(doc, await embedFonts(doc), d);
  return { pages, bytes: await doc.save() };
}

describe("appendCertificate", () => {
  it("lists the envelope, every recipient, the hashes and the audit trail", async () => {
    const { pages, bytes } = await render(sampleCertificate());
    expect(pages).toBe(1);
    const text = (await visibleText(bytes)).filter((t) => t.page === 2).map((t) => t.str).join("\n");
    for (const s of ["Certificate of completion", "Service Agreement <2026>", "sam@acme.test", "a".repeat(64), "b".repeat(64), "Zoë Иванова", "203.0.113.7", "2026-09-28 10:04:00 UTC", "carl@x.test", "Receives a copy", "Sam Sender"]) {
      expect(text).toContain(s);
    }
    // CJK is not in the font: shown as "?", the email keeps the identity clear.
    expect(text).toContain("? ? <li@x.test>");
  });

  it("flows onto more pages with numbered footers", async () => {
    const { pages, bytes } = await render(sampleCertificate(120));
    expect(pages).toBeGreaterThan(1);
    const text = (await visibleText(bytes)).map((t) => t.str).join("\n");
    expect(text).toContain(`Certificate page ${pages} of ${pages}`);
    expect(text).toContain("Certificate of completion (continued)");
  });
});
