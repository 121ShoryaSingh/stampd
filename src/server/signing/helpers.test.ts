import { describe, it, expect } from "vitest";
import { newCode, hashCode } from "./otp";
import { signerSessionValue, isValidSession, SESSION_TTL_MS } from "./session";

describe("codes", () => {
  it("are 6 digits and vary", () => {
    const codes = new Set(Array.from({ length: 50 }, newCode));
    expect([...codes].every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(codes.size).toBeGreaterThan(40);
  });
  it("hash per recipient", () => {
    expect(hashCode("r1", "123456")).toBe(hashCode("r1", "123456"));
    expect(hashCode("r1", "123456")).not.toBe(hashCode("r2", "123456"));
  });
});

describe("signer session", () => {
  const at = new Date("2026-01-01T10:00:00Z");
  it("accepts its own value within the TTL", () => {
    expect(isValidSession(signerSessionValue("r1", at), "r1", at, new Date(at.getTime() + 60_000))).toBe(true);
  });
  it("rejects another recipient, a changed verification time, expiry, and garbage", () => {
    const v = signerSessionValue("r1", at);
    expect(isValidSession(v, "r2", at, at)).toBe(false);
    expect(isValidSession(v, "r1", new Date(at.getTime() + 1), at)).toBe(false);
    expect(isValidSession(v, "r1", at, new Date(at.getTime() + SESSION_TTL_MS + 1))).toBe(false);
    expect(isValidSession("nope", "r1", at, at)).toBe(false);
    expect(isValidSession(undefined, "r1", at, at)).toBe(false);
    expect(isValidSession(v, "r1", null, at)).toBe(false);
  });
});
