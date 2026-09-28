import { describe, it, expect, afterAll } from "vitest";
import { adminDb } from "../../../tests/helpers/db";
import { sentEnvelope } from "../../../tests/helpers/signing";
import { tokenFor } from "../../../tests/helpers/mail";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { openLink } from "@/server/signing/service";
import { resendInvite, voidEnvelope } from "@/server/envelopes/service";
import { expireDue, remindDue } from "./ticks";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

const DAY = 86_400_000;
const meta = { ip: null, userAgent: null };
const inDays = (d: number) => new Date(Date.now() + d * DAY);
const events = (tenantId: string, envelopeId: string) => withTenant(tenantId, (tx) => listAudit(tx, envelopeId)).then((r) => r.map((e) => e.event));
const jobs = (envelopeId: string, kind: string) => admin.emailJob.findMany({ where: { envelopeId, kind } });

describe("remindDue", () => {
  it("reminds once per interval with a fresh link; the old link stops working", async () => {
    const s = await sentEnvelope(admin, { reminderEveryDays: 3 });
    const old = s.links[0].token!;
    expect(await remindDue({ tenantId: s.tenantId, now: inDays(2.9) })).toEqual({ reminded: 0 });
    expect(await remindDue({ tenantId: s.tenantId, now: inDays(3.01) })).toEqual({ reminded: 1 });
    // Same tick again (or a second worker): nothing more.
    expect(await remindDue({ tenantId: s.tenantId, now: inDays(3.02) })).toEqual({ reminded: 0 });

    const fresh = (await tokenFor(admin, s.links[0].recipientId))!;
    expect(fresh).not.toBe(old);
    await expect(openLink(old, meta)).rejects.toThrow(/not valid/);
    expect((await openLink(fresh, meta)).state).toBe("ready");
    expect(await jobs(s.envelopeId, "reminder")).toHaveLength(1);
    expect(await events(s.tenantId, s.envelopeId)).toContain("reminded");

    // The next reminder counts from the last one.
    expect(await remindDue({ tenantId: s.tenantId, now: inDays(5.9) })).toEqual({ reminded: 0 });
    expect(await remindDue({ tenantId: s.tenantId, now: inDays(6.1) })).toEqual({ reminded: 1 });
  });

  it("two workers at once send one reminder", async () => {
    const s = await sentEnvelope(admin, { reminderEveryDays: 1 });
    const [a, b] = await Promise.all([remindDue({ tenantId: s.tenantId, now: inDays(1.1) }), remindDue({ tenantId: s.tenantId, now: inDays(1.1) })]);
    expect(a.reminded + b.reminded).toBe(1);
    expect(await jobs(s.envelopeId, "reminder")).toHaveLength(1);
  });

  it("skips reminders when off, voided, expired, or not started", async () => {
    const off = await sentEnvelope(admin);
    expect(await remindDue({ tenantId: off.tenantId, now: inDays(10) })).toEqual({ reminded: 0 });

    const voided = await sentEnvelope(admin, { reminderEveryDays: 1 });
    await voidEnvelope({ tenantId: voided.tenantId, userId: voided.userId, envelopeId: voided.envelopeId, reason: "x" });
    expect(await remindDue({ tenantId: voided.tenantId, now: inDays(2) })).toEqual({ reminded: 0 });

    const late = await sentEnvelope(admin, { reminderEveryDays: 1 });
    expect(await remindDue({ tenantId: late.tenantId, now: inDays(31) })).toEqual({ reminded: 0 });

    // Step 2 was never invited, so only step 1 is reminded.
    const steps = await sentEnvelope(admin, { signers: 2, reminderEveryDays: 1 });
    expect(await remindDue({ tenantId: steps.tenantId, now: inDays(2) })).toEqual({ reminded: 1 });
    expect((await jobs(steps.envelopeId, "reminder")).map((j) => j.toEmail)).toEqual(["s1@x.dev"]);
  });
});

describe("expireDue", () => {
  it("expires once and tells the sender", async () => {
    const s = await sentEnvelope(admin);
    expect(await expireDue({ tenantId: s.tenantId, now: inDays(29) })).toEqual({ expired: 0 });
    const [a, b] = await Promise.all([expireDue({ tenantId: s.tenantId, now: inDays(31) }), expireDue({ tenantId: s.tenantId, now: inDays(31) })]);
    expect(a.expired + b.expired).toBe(1);
    expect((await admin.envelope.findUniqueOrThrow({ where: { id: s.envelopeId } })).status).toBe("expired");
    const sender = await admin.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect((await jobs(s.envelopeId, "expired")).map((j) => j.toEmail)).toEqual([sender.email]);
    expect((await events(s.tenantId, s.envelopeId)).filter((e) => e === "expired")).toHaveLength(1);
  });
});

describe("resendInvite", () => {
  it("issues a fresh link for an active signer only", async () => {
    const s = await sentEnvelope(admin, { signers: 2 });
    const base = { tenantId: s.tenantId, userId: s.userId, envelopeId: s.envelopeId };
    await resendInvite({ ...base, recipientId: s.links[0].recipientId });
    const fresh = (await tokenFor(admin, s.links[0].recipientId))!;
    expect(fresh).not.toBe(s.links[0].token);
    await expect(openLink(s.links[0].token!, meta)).rejects.toThrow(/not valid/);
    expect(await events(s.tenantId, s.envelopeId)).toContain("link_reissued");
    await expect(resendInvite({ ...base, recipientId: s.links[1].recipientId })).rejects.toThrow(/not waiting/);

    await voidEnvelope({ ...base, reason: "x" });
    await expect(resendInvite({ ...base, recipientId: s.links[0].recipientId })).rejects.toThrow(/open envelopes/);
  });

  it("cannot target another workspace's recipient", async () => {
    const a = await sentEnvelope(admin);
    const b = await sentEnvelope(admin);
    await expect(resendInvite({ tenantId: a.tenantId, userId: a.userId, envelopeId: a.envelopeId, recipientId: b.links[0].recipientId })).rejects.toThrow(/not found/i);
  });
});
