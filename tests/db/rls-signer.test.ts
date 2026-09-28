import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../helpers/db";
import { seedDraft } from "../helpers/envelopes";
import { withDb } from "@/server/db/context";

const admin = adminDb();
beforeAll(async () => {
  const t = await insertTenant(admin, "SignRls");
  const u = await insertUser(admin);
  const env = await seedDraft(admin, t, u.id);
  await admin.recipient.createMany({
    data: [
      { tenantId: t, envelopeId: env, name: "A", email: "a@x.dev", tokenHash: "tok-a" },
      { tenantId: t, envelopeId: env, name: "B", email: "b@x.dev", tokenHash: "tok-b" },
    ],
  });
});
afterAll(async () => {
  await admin.$disconnect();
});

describe("recipient token policy", () => {
  it("a token reveals only its own recipient", async () => {
    const rows = await withDb({ tokenHash: "tok-a" }, (tx) => tx.recipient.findMany());
    expect(rows.map((r) => r.email)).toEqual(["a@x.dev"]);
  });
  it("a token reveals nothing else", async () => {
    const [envs, fields] = await withDb({ tokenHash: "tok-a" }, async (tx) => [await tx.envelope.findMany(), await tx.field.findMany()]);
    expect(envs).toHaveLength(0);
    expect(fields).toHaveLength(0);
  });
  it("a token grants no writes", async () => {
    await expect(withDb({ tokenHash: "tok-a" }, (tx) => tx.recipient.updateMany({ data: { name: "x" } }))).resolves.toEqual({ count: 0 });
  });
});
