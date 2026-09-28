import { describe, it, expect } from "vitest";
import { canonicalJson } from "./canonical";

describe("canonicalJson", () => {
  it("sorts keys at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}');
  });
  it("drops undefined values like JSON does", () => {
    expect(canonicalJson({ a: undefined, b: 2 })).toBe('{"b":2}');
  });
});
