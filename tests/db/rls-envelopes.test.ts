import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../helpers/db";
import { seedDraft } from "../helpers/envelopes";
import { withTenant } from "@/server/db/context";

const admin = adminDb();
let a: string, b: string, envB: string;

beforeAll(async () => {
  a = await insertTenant(admin, "EnvA");
  b = await insertTenant(admin, "EnvB");
  const u = await insertUser(admin);
  await seedDraft(admin, a, u.id, "mine");
  envB = await seedDraft(admin, b, u.id, "theirs");
  await admin.recipient.create({ data: { tenantId: b, envelopeId: envB, name: "R", email: "r@b.dev" } });
  await admin.auditEvent.create({ data: { tenantId: b, envelopeId: envB, seq: 1, actorType: "system", event: "created", createdAt: new Date(), hash: "h" } });
});
afterAll(async () => {
  await admin.$disconnect();
});

describe("envelope tables RLS", () => {
  it("lists only the current tenant's envelopes", async () => {
    const rows = await withTenant(a, (tx) => tx.envelope.findMany());
    expect(rows.map((r) => r.title)).toEqual(["mine"]);
  });

  it("hides another tenant's recipients and audit events", async () => {
    const [r, e] = await withTenant(a, async (tx) => [await tx.recipient.findMany(), await tx.auditEvent.findMany()]);
    expect(r).toHaveLength(0);
    expect(e).toHaveLength(0);
  });

  it("cannot attach a recipient to another tenant's envelope", async () => {
    await expect(withTenant(a, (tx) => tx.recipient.create({ data: { tenantId: b, envelopeId: envB, name: "X", email: "x@x.dev" } }))).rejects.toThrow(
      /row-level security/,
    );
  });

  it("the app cannot update or delete audit events", async () => {
    await expect(withTenant(b, (tx) => tx.auditEvent.updateMany({ data: { event: "x" } }))).rejects.toThrow(/permission denied/);
    await expect(withTenant(b, (tx) => tx.auditEvent.deleteMany())).rejects.toThrow(/permission denied/);
  });
});
