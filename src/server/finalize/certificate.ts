import { rgb, type PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import { describeEvent } from "@/server/audit/describe";
import { printable } from "./fonts";

export type CertificateRecipient = {
  id: string;
  name: string;
  email: string;
  role: "signer" | "cc";
  status: string;
  routingOrder: number;
  viewedAt: Date | null;
  otpVerifiedAt: Date | null;
  consentedAt: Date | null;
  signedAt: Date | null;
  signIp: string | null;
  signUserAgent: string | null;
};

export type CertificateEvent = { seq: number; createdAt: Date; event: string; actorType: string; actorId: string | null; ip: string | null };

export type CertificateData = {
  envelopeId: string;
  title: string;
  sender: { name: string; email: string };
  sentAt: Date | null;
  completedAt: Date | null;
  document: { filename: string; pageCount: number; sha256: string };
  recipients: CertificateRecipient[];
  events: CertificateEvent[];
  actors: Record<string, string>; // user id -> name, for team members in the audit trail
  auditHash: string;
  generatedAt: Date;
};

// A4, as the certificate is read worldwide.
const PAGE: [number, number] = [595.28, 841.89];
const M = 48;
const INK = rgb(0, 0, 0);
const MUTED = rgb(0.3, 0.3, 0.3);
const YELLOW = rgb(1, 0.9, 0);
const LABEL_W = 132;

export const stamp = (d: Date | null) => (d ? `${d.toISOString().slice(0, 19).replace("T", " ")} UTC` : "-");

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxW) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const ch of word) {
      if (line && font.widthOfTextAtSize(line + ch, size) > maxW) {
        lines.push(line);
        line = "";
      }
      line += ch;
    }
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

// Top-down writer that starts a new page when the current one is full.
class Writer {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private continued: string,
  ) {
    this.newPage(true);
  }

  newPage(first = false) {
    this.page = this.doc.addPage(PAGE);
    this.pages.push(this.page);
    this.y = PAGE[1] - M;
    if (!first) this.text(this.continued, { size: 9, color: MUTED, gap: 10 });
  }

  ensure(h: number) {
    if (this.y - h < M + 28) this.newPage();
  }

  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const x = M + (o.x ?? 0);
    const lines = wrap(printable(s), font, size, (o.width ?? PAGE[0] - 2 * M) - (o.x ?? 0));
    for (const line of lines) {
      this.ensure(size * 1.35);
      this.y -= size * 1.35;
      this.page.drawText(line, { x, y: this.y, size, font, color: o.color ?? INK });
    }
    this.y -= o.gap ?? 0;
  }

  // Label on the left, wrapped value on the right; the label stays with the first value line.
  row(label: string, value: string, size = 9) {
    const lines = wrap(printable(value), this.font, size, PAGE[0] - 2 * M - LABEL_W);
    lines.forEach((line, i) => {
      this.ensure(size * 1.4);
      this.y -= size * 1.4;
      if (i === 0) this.page.drawText(label.toUpperCase(), { x: M, y: this.y, size: size - 1.5, font: this.bold, color: MUTED });
      this.page.drawText(line, { x: M + LABEL_W, y: this.y, size, font: this.font, color: INK });
    });
  }

  heading(s: string) {
    this.ensure(40);
    this.y -= 14;
    this.page.drawRectangle({ x: M, y: this.y - 16, width: PAGE[0] - 2 * M, height: 20, color: YELLOW, borderColor: INK, borderWidth: 1.5 });
    this.page.drawText(s.toUpperCase(), { x: M + 6, y: this.y - 10, size: 10, font: this.bold, color: INK });
    this.y -= 24;
  }

  rule() {
    this.y -= 6;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: PAGE[0] - M, y: this.y }, thickness: 0.75, color: MUTED });
    this.y -= 2;
  }
}

// Appends the certificate of completion (one or more A4 pages) to the document.
export function appendCertificate(doc: PDFDocument, fonts: { regular: PDFFont; bold: PDFFont }, d: CertificateData) {
  const w = new Writer(doc, fonts.regular, fonts.bold, `Certificate of completion (continued) - envelope ${d.envelopeId}`);
  const top = w.page;
  top.drawRectangle({ x: M, y: PAGE[1] - M - 54, width: PAGE[0] - 2 * M, height: 54, color: INK });
  top.drawText("STAMPD", { x: M + 14, y: PAGE[1] - M - 24, size: 11, font: fonts.bold, color: YELLOW });
  top.drawText("Certificate of completion", { x: M + 14, y: PAGE[1] - M - 44, size: 18, font: fonts.bold, color: rgb(1, 1, 1) });
  w.y = PAGE[1] - M - 66;

  w.heading("Envelope");
  w.row("Title", d.title);
  w.row("Envelope ID", d.envelopeId);
  w.row("Sender", `${d.sender.name} <${d.sender.email}>`);
  w.row("Sent", stamp(d.sentAt));
  w.row("Completed", stamp(d.completedAt));
  w.row("Document", `${d.document.filename} (${d.document.pageCount} ${d.document.pageCount === 1 ? "page" : "pages"})`);
  w.row("Original SHA-256", d.document.sha256);

  w.heading("Signers and recipients");
  const ordered = [...d.recipients].sort((a, b) => (a.role === b.role ? a.routingOrder - b.routingOrder : a.role === "signer" ? -1 : 1));
  ordered.forEach((r, i) => {
    if (i > 0) w.rule();
    w.text(`${r.name} <${r.email}>`, { size: 10, bold: true, gap: 2 });
    w.row("Role", r.role === "signer" ? `Signer, step ${r.routingOrder}` : "Receives a copy");
    if (r.role === "signer") {
      w.row("Opened", stamp(r.viewedAt));
      w.row("Email code verified", stamp(r.otpVerifiedAt));
      w.row("Agreed to e-sign", stamp(r.consentedAt));
      w.row("Signed", stamp(r.signedAt));
      w.row("IP address", r.signIp ?? "-");
      w.row("Device", (r.signUserAgent ?? "-").slice(0, 300));
    }
  });

  w.heading("Audit trail");
  w.text("Each event is chained to the one before it with SHA-256; changing any event breaks every later hash.", { size: 8.5, color: MUTED, gap: 4 });
  const names = new Map([...Object.entries(d.actors), ...d.recipients.map((r) => [r.id, r.name] as const)]);
  for (const e of d.events) {
    const who = (e.actorId && names.get(e.actorId)) || "Someone";
    w.row(stamp(e.createdAt).replace(" UTC", ""), `${describeEvent(e.event, who)}${e.ip ? ` (IP ${e.ip})` : ""}`, 8.5);
  }
  w.rule();
  w.row("Audit hash", `${d.auditHash} (after event ${d.events.at(-1)?.seq ?? 0})`);
  w.row("Generated", stamp(d.generatedAt));

  // Footers once the page count is known.
  w.pages.forEach((p, i) => {
    p.drawText(printable(`This PDF is sealed by Stampd. Any change to it invalidates the seal.   Certificate page ${i + 1} of ${w.pages.length}`), {
      x: M,
      y: M - 20,
      size: 7.5,
      font: fonts.regular,
      color: MUTED,
    });
  });
  return w.pages.length;
}
