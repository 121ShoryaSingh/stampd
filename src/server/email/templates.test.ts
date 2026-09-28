import { describe, it, expect } from "vitest";
import { escapeHtml, renderEmail, type EmailData, type EmailKind } from "./templates";

const evil = `<script>alert("x")</script> & 'q'`;
const samples: { [K in EmailKind]: EmailData[K] } = {
  invite: { title: evil, senderName: evil, recipientName: evil, message: evil, url: "https://s.test/sign/abc?x=1&y=2", expiresAt: "2026-10-01T00:00:00Z" },
  reminder: { title: evil, senderName: evil, recipientName: evil, url: "https://s.test/sign/def", expiresAt: "2026-10-01T00:00:00Z" },
  otp: { title: evil, code: "123456" },
  declined: { title: evil, signerName: evil, signerEmail: "a@x.dev", reason: evil, envelopeUrl: "https://s.test/envelopes/1" },
  completed: { title: evil, envelopeUrl: "https://s.test/envelopes/1" },
  expired: { title: evil, envelopeUrl: "https://s.test/envelopes/1" },
  voided: { title: evil, senderName: evil, reason: evil },
};

describe("escapeHtml", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});

describe("renderEmail", () => {
  for (const kind of Object.keys(samples) as EmailKind[]) {
    it(`${kind}: renders and escapes user text`, () => {
      const m = renderEmail(kind, samples[kind]);
      expect(m.subject.length).toBeGreaterThan(0);
      expect(m.subject.length).toBeLessThanOrEqual(150);
      expect(m.html).not.toContain("<script>");
      expect(m.html).toContain("&lt;script&gt;");
      expect(m.text).toContain("-- Stampd");
    });
  }

  it("puts the link in text and HTML, with & escaped in HTML", () => {
    const m = renderEmail("invite", samples.invite);
    expect(m.text).toContain("https://s.test/sign/abc?x=1&y=2");
    expect(m.html).toContain('href="https://s.test/sign/abc?x=1&amp;y=2"');
  });

  it("keeps subjects on one line", () => {
    const m = renderEmail("completed", { title: "A\r\nBcc: evil@x.dev\nB", envelopeUrl: "https://s.test" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe('Completed: "A Bcc: evil@x.dev B"');
  });

  it("caps long subjects at 150 characters", () => {
    expect(renderEmail("completed", { title: "x".repeat(400), envelopeUrl: "https://s.test" }).subject).toHaveLength(150);
  });

  it("includes the code and the optional message", () => {
    expect(renderEmail("otp", samples.otp).text).toContain("123456");
    const plain = { ...samples.invite, title: "T", senderName: "S", recipientName: "R" };
    expect(renderEmail("invite", { ...plain, message: "Line 1\nLine 2" }).text).toContain("> Line 1\n> Line 2");
    expect(renderEmail("invite", { ...plain, message: null }).text).not.toContain("> ");
  });
});
