import { describe, it, expect } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it.each([
    ["/settings/team", "/settings/team"],
    ["/invite/abc?x=1", "/invite/abc?x=1"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["//evil.com", "/dashboard"],
    ["/\\evil.com", "/dashboard"],
    ["https://evil.com", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ])("safeNext(%s) -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
