import { describe, it, expect } from "vitest";
import { pruneOrphanFields } from "./prune";

describe("pruneOrphanFields", () => {
  it("drops fields whose recipient is no longer a signer", () => {
    const fields = [{ key: "1", recipientId: "a" }, { key: "2", recipientId: "gone" }, { key: "3", recipientId: "b" }];
    expect(pruneOrphanFields(fields, ["a", "b"]).map((f) => f.key)).toEqual(["1", "3"]);
  });
  it("returns the same array when nothing changes", () => {
    const fields = [{ key: "1", recipientId: "a" }];
    expect(pruneOrphanFields(fields, ["a"])).toBe(fields);
  });
});
