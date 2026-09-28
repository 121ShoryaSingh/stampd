import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser, insertTenant } from "../helpers/db";
import { seedDraft } from "../helpers/envelopes";
import { withDb, withTenant } from "@/server/db/context";

const admin = adminDb();
let a: string, b: string, envA: string, envB: string;

beforeAll(async () => {
  const u = await insertUser(admin);
  [a, b] = [await insertTenant(admin, "MailA"), await insertTenant(admin, "MailB")];
  [envA, envB] = [await seedDraft(admin, a, u.id), await seedDraft(admin, b, u.id)];
  for (const [t, e] of [[a, envA], [b, envB]]) {
    await admin.recipient.create({ data: { tenantId: t, envelopeId: e, name: "R", email: `r-${t}@x.dev` } });
    await admin.emailJob.create({ data: { tenantId: t, envelopeId: e, kind: "completed", toEmail: `s-${t}@x.dev` } });
  }
});
afterAll(async () => {
  await admin.$disconnect();
});

describe("email_jobs isolation", () => {
  it("a tenant sees only its own jobs", async () => {
    const rows = await withTenant(a, (tx) => tx.emailJob.findMany());
    expect(rows.map((r) => r.envelopeId)).toEqual([envA]);
  });

  it("a tenant cannot queue a job for another tenant", async () => {
    await expect(withTenant(a, (tx) => tx.emailJob.create({ data: { tenantId: b, envelopeId: envB, kind: "completed", toEmail: "x@x.dev" } }))).rejects.toThrow();
  });

  it("no context sees nothing", async () => {
    expect(await withDb({}, (tx) => tx.emailJob.count({ where: { envelopeId: { in: [envA, envB] } } }))).toBe(0);
  });
});

describe("worker discovery flag", () => {
  it("reads jobs, envelopes and recipients of every tenant", async () => {
    const [jobs, envs, recs] = await withDb({ worker: true }, async (tx) => [
      await tx.emailJob.count({ where: { envelopeId: { in: [envA, envB] } } }),
      await tx.envelope.count({ where: { id: { in: [envA, envB] } } }),
      await tx.recipient.count({ where: { envelopeId: { in: [envA, envB] } } }),
    ]);
    expect([jobs, envs, recs]).toEqual([2, 2, 2]);
  });

  it("does not reveal other tables", async () => {
    const [docs, fields, audit] = await withDb({ worker: true }, async (tx) => [await tx.document.count(), await tx.field.count(), await tx.auditEvent.count()]);
    expect([docs, fields, audit]).toEqual([0, 0, 0]);
  });

  it("cannot write", async () => {
    const res = await withDb({ worker: true }, (tx) => tx.emailJob.updateMany({ where: { envelopeId: envA }, data: { lastError: "x" } }));
    expect(res.count).toBe(0);
    await expect(withDb({ worker: true }, (tx) => tx.emailJob.create({ data: { tenantId: a, envelopeId: envA, kind: "completed", toEmail: "x@x.dev" } }))).rejects.toThrow();
    const env = await withDb({ worker: true }, (tx) => tx.envelope.updateMany({ where: { id: envA }, data: { title: "hacked" } }));
    expect(env.count).toBe(0);
  });
});
