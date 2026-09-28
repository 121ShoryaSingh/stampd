import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { sendMail, emailConfigured } from "./mailer";
import { lastMailTo } from "../../../tests/helpers/mail";

describe("sendMail", () => {
  it("delivers over SMTP with the configured sender", async () => {
    expect(emailConfigured()).toBe(true);
    const to = `m-${randomUUID()}@x.dev`;
    await sendMail({ to, toName: "Mia", subject: "Hello", text: "Plain body", html: "<p>Html body</p>" });
    const m = await lastMailTo(to);
    expect(m?.Subject).toBe("Hello");
    expect(m?.From).toMatchObject({ Name: "Stampd Test", Address: "no-reply@stampd.test" });
    expect(m?.To[0]).toMatchObject({ Name: "Mia", Address: to });
    expect(m?.Text.trim()).toBe("Plain body");
    expect(m?.HTML).toContain("Html body");
  });
});
