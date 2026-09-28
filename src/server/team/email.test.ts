import { describe, it, expect } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Bob@Acme.COM ")).toBe("bob@acme.com");
  });
  it("rejects invalid addresses", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow(/valid email/);
    expect(() => normalizeEmail("")).toThrow(/valid email/);
  });
});
