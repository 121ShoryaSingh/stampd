import { describe, it, expect, afterAll } from "vitest";
import { adminDb } from "../../../tests/helpers/db";
import { sentEnvelope } from "../../../tests/helpers/signing";
import { lastMailTo } from "../../../tests/helpers/mail";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { deliveries, processDueEmails, LEASE_MS, MAX_ATTEMPTS } from "./outbox";
import type { OutgoingMail } from "./mailer";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

const events = (tenantId: string, envelopeId: string) => withTenant(tenantId, (tx) => listAudit(tx, envelopeId)).then((r) => r.map((e) => e.event));
const failing = async () => {
  throw new Error("421 try again later");
};

describe("processDueEmails", () => {
  it("sends a due invite once, scrubs the link and audits it", async () => {
    const s = await sentEnvelope(admin);
    const job = await admin.emailJob.findFirstOrThrow({ where: { envelopeId: s.envelopeId, kind: "invite" } });
    expect((job.data as { url: string }).url).toContain(s.links[0].token);

    expect(await processDueEmails({ tenantId: s.tenantId })).toEqual({ sent: 1, failed: 0, retried: 0 });
    const mail = await lastMailTo("s1@x.dev");
    expect(mail?.Subject).toContain("Service Agreement");
    expect(mail?.Text).toContain(`/sign/${s.links[0].token}`);

    const after = await admin.emailJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "sent", attempts: 1, lockedUntil: null });
    expect(after.data).not.toHaveProperty("url");
    expect(after.data).toMatchObject({ title: "Service Agreement" });
    expect(await events(s.tenantId, s.envelopeId)).toContain("email_sent");
    expect(await processDueEmails({ tenantId: s.tenantId })).toEqual({ sent: 0, failed: 0, retried: 0 });
  });

  it("sends once when two workers run at the same time", async () => {
    const s = await sentEnvelope(admin, { signers: 3, sameStep: true });
    const sent: OutgoingMail[] = [];
    const send = async (m: OutgoingMail) => {
      sent.push(m);
    };
    const [a, b] = await Promise.all([processDueEmails({ tenantId: s.tenantId, send }), processDueEmails({ tenantId: s.tenantId, send })]);
    expect(a.sent + b.sent).toBe(3);
    expect(sent.map((m) => m.to).sort()).toEqual(["s1@x.dev", "s2@x.dev", "s3@x.dev"]);
  });

  it("retries after an expired lease, not before", async () => {
    const s = await sentEnvelope(admin);
    const job = await admin.emailJob.findFirstOrThrow({ where: { envelopeId: s.envelopeId } });
    const t0 = new Date();
    await admin.emailJob.update({ where: { id: job.id }, data: { lockedUntil: new Date(t0.getTime() + LEASE_MS), attempts: 1 } });
    expect((await processDueEmails({ tenantId: s.tenantId, send: async () => {} })).sent).toBe(0);
    const later = () => new Date(t0.getTime() + LEASE_MS + 1000);
    expect((await processDueEmails({ tenantId: s.tenantId, send: async () => {}, now: later })).sent).toBe(1);
    expect((await admin.emailJob.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(2);
  });

  it("backs off on errors and gives up after the last attempt", async () => {
    const s = await sentEnvelope(admin);
    const job = await admin.emailJob.findFirstOrThrow({ where: { envelopeId: s.envelopeId } });
    let t = Date.now();
    const now = () => new Date(t);
    const waits: number[] = [];
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await processDueEmails({ tenantId: s.tenantId, send: failing, now })).toEqual({ sent: 0, failed: 0, retried: 1 });
      const j = await admin.emailJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(j).toMatchObject({ status: "queued", attempts: i, lastError: "421 try again later", lockedUntil: null });
      waits.push(j.runAt.getTime() - t);
      // Not due yet: nothing happens.
      expect((await processDueEmails({ tenantId: s.tenantId, send: failing, now })).retried).toBe(0);
      t = j.runAt.getTime();
    }
    expect(waits).toEqual([30_000, 120_000, 600_000, 1_800_000]);
    expect(await processDueEmails({ tenantId: s.tenantId, send: failing, now })).toEqual({ sent: 0, failed: 1, retried: 0 });
    const dead = await admin.emailJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(dead.status).toBe("failed");
    expect(dead.data).not.toHaveProperty("url");
    expect(await events(s.tenantId, s.envelopeId)).toContain("email_failed");

    const d = await deliveries(s.tenantId, s.envelopeId);
    expect(d[s.links[0].recipientId]).toMatchObject({ kind: "invite", status: "failed", lastError: "421 try again later" });
  });

  it("scrubs the code from a sent code email", async () => {
    const s = await sentEnvelope(admin);
    const { requestCode } = await import("@/server/signing/service");
    await requestCode(s.links[0].token!, { ip: null, userAgent: null });
    await processDueEmails({ tenantId: s.tenantId });
    const otp = await admin.emailJob.findFirstOrThrow({ where: { envelopeId: s.envelopeId, kind: "otp" } });
    expect(otp.status).toBe("sent");
    expect(otp.data).not.toHaveProperty("code");
    expect((await lastMailTo("s1@x.dev"))?.Subject).toMatch(/^Your Stampd code: \d{6}$/);
  });
});
