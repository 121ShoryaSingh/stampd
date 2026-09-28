import { describe, it, expect } from "vitest";
import { pickActiveTenant, slugify } from "./pick";

const t = (id: string) => ({ tenantId: id, name: id, slug: id, role: "member" as const });

describe("pickActiveTenant", () => {
  it("uses the cookie when the user is a member", () => {
    expect(pickActiveTenant([t("a"), t("b")], "b")?.tenantId).toBe("b");
  });
  it("ignores a cookie for a workspace the user is not in", () => {
    expect(pickActiveTenant([t("a"), t("b")], "evil")?.tenantId).toBe("a");
  });
  it("falls back to the first workspace without a cookie", () => {
    expect(pickActiveTenant([t("a")], undefined)?.tenantId).toBe("a");
  });
  it("returns null when the user has no workspaces", () => {
    expect(pickActiveTenant([], "a")).toBeNull();
  });
});

describe("slugify", () => {
  it("lowercases, dashes, trims and strips symbols", () => {
    expect(slugify("  Acme & Sons, Ltd.  ")).toBe("acme-sons-ltd");
  });
  it("falls back for names with no usable characters", () => {
    expect(slugify("!!!")).toBe("workspace");
  });
});
