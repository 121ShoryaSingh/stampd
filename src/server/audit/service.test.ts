import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../../../tests/helpers/db";
import { seedDraft } from "../../../tests/helpers/envelopes";
import { withTenant } from "@/server/db/context";
import { appendAudit, verifyChain, listAudit } from "./service";

const admin = adminDb();
let tenantId: string, userId: string, envelopeId: string;

beforeAll(async () => {
  tenantId = await insertTenant(admin, "Audit");
  userId = (await insertUser(admin)).id;
  envelopeId = await seedDraft(admin, tenantId, userId);
});
afterAll(async () => {
  await admin.$disconnect();
});

const ev = (envId: string, event: string) => ({ tenantId, envelopeId: envId, actorType: "system" as const, event, data: { n: event } });

describe("audit log", () => {
  it("chains each event to the previous hash", async () => {
    const e1 = await withTenant(tenantId, (tx) => appendAudit(tx, ev(envelopeId, "created")));
    const e2 = await withTenant(tenantId, (tx) => appendAudit(tx, ev(envelopeId, "sent")));
    const rows = await withTenant(tenantId, (tx) => listAudit(tx, envelopeId));
    expect(rows.map((r) => [r.seq, r.event])).toEqual([[1, "created"], [2, "sent"]]);
    expect(rows[1].prevHash).toBe(e1.hash);
    expect(e2.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await withTenant(tenantId, (tx) => verifyChain(tx, envelopeId))).toEqual({ ok: true, lastHash: e2.hash });
  });

  it("detects a tampered event", async () => {
    const env2 = await seedDraft(admin, tenantId, userId);
    await withTenant(tenantId, (tx) => appendAudit(tx, ev(env2, "created")));
    await withTenant(tenantId, (tx) => appendAudit(tx, ev(env2, "sent")));
    await admin.auditEvent.updateMany({ where: { envelopeId: env2, event: "created" }, data: { data: { n: "forged" } } });
    expect((await withTenant(tenantId, (tx) => verifyChain(tx, env2))).ok).toBe(false);
  });

  it("keeps the chain linear under concurrent appends", async () => {
    const env3 = await seedDraft(admin, tenantId, userId);
    await Promise.all(Array.from({ length: 8 }, (_, i) => withTenant(tenantId, (tx) => appendAudit(tx, ev(env3, `e${i}`)))));
    const rows = await withTenant(tenantId, (tx) => listAudit(tx, env3));
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await withTenant(tenantId, (tx) => verifyChain(tx, env3))).ok).toBe(true);
  });
});
