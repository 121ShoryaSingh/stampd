import { describe, it, expect, afterAll } from "vitest";
import { adminDb } from "../../../tests/helpers/db";
import { sentEnvelope } from "../../../tests/helpers/signing";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { voidEnvelope } from "@/server/envelopes/service";
import { openLink, requestCode, verifyCode, giveConsent, requireSignerSession, getSigningView } from "./service";
import { signerSessionValue } from "./session";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

const meta = { ip: "203.0.113.7", userAgent: "vitest" };
const events = (tenantId: string, envelopeId: string) => withTenant(tenantId, (tx) => listAudit(tx, envelopeId)).then((r) => r.map((e) => e.event));

async function verified(token: string) {
  const { devCode } = await requestCode(token, meta);
  return verifyCode(token, devCode!, meta);
}

describe("opening a link", () => {
  it("rejects an unknown token", async () => {
    await expect(openLink("not-a-real-token", meta)).rejects.toThrow(/not valid/);
  });

  it("marks the first open as viewed, once", async () => {
    const s = await sentEnvelope(admin);
    const first = await openLink(s.links[0].token, meta);
    expect(first).toMatchObject({ state: "ready", name: "Signer 1", title: "Service Agreement", verified: false, consented: false });
    await openLink(s.links[0].token, meta);
    const rec = await admin.recipient.findUniqueOrThrow({ where: { id: s.links[0].recipientId } });
    expect(rec.status).toBe("viewed");
    expect((await events(s.tenantId, s.envelopeId)).filter((e) => e === "viewed")).toHaveLength(1);
  });

  it("shows 'waiting' when it is not this signer's turn", async () => {
    const s = await sentEnvelope(admin, { signers: 2 });
    expect((await openLink(s.links[1].token, meta)).state).toBe("waiting");
    await expect(requestCode(s.links[1].token, meta)).rejects.toThrow(/not your turn/);
  });

  it("is closed after voiding or expiry", async () => {
    const voided = await sentEnvelope(admin);
    await voidEnvelope({ tenantId: voided.tenantId, userId: voided.userId, envelopeId: voided.envelopeId, reason: "x" });
    expect((await openLink(voided.links[0].token, meta)).state).toBe("closed");

    const expired = await sentEnvelope(admin);
    await admin.envelope.update({ where: { id: expired.envelopeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await openLink(expired.links[0].token, meta)).state).toBe("closed");
    await expect(requestCode(expired.links[0].token, meta)).rejects.toThrow(/closed/);
  });
});

describe("code check", () => {
  it("sends a 6-digit code, stores only a hash, and rate-limits resends", async () => {
    const s = await sentEnvelope(admin);
    const { devCode } = await requestCode(s.links[0].token, meta);
    expect(devCode).toMatch(/^\d{6}$/);
    const rec = await admin.recipient.findUniqueOrThrow({ where: { id: s.links[0].recipientId } });
    expect(rec.otpHash).not.toContain(devCode!);
    expect(await events(s.tenantId, s.envelopeId)).toContain("otp_sent");
    await expect(requestCode(s.links[0].token, meta)).rejects.toThrow(/wait/);
  });

  it("counts wrong codes and locks after 5", async () => {
    const s = await sentEnvelope(admin);
    const { devCode } = await requestCode(s.links[0].token, meta);
    const wrong = devCode === "000000" ? "111111" : "000000";
    await expect(verifyCode(s.links[0].token, wrong, meta)).rejects.toThrow(/Wrong code/);
    expect((await admin.recipient.findUniqueOrThrow({ where: { id: s.links[0].recipientId } })).otpAttempts).toBe(1);
    expect(await events(s.tenantId, s.envelopeId)).toContain("otp_failed");
    for (let i = 0; i < 4; i++) await expect(verifyCode(s.links[0].token, wrong, meta)).rejects.toThrow(/Wrong code/);
    await expect(verifyCode(s.links[0].token, devCode!, meta)).rejects.toThrow(/Too many attempts/);

    await admin.recipient.update({ where: { id: s.links[0].recipientId }, data: { otpSentAt: new Date(Date.now() - 60_000) } });
    const fresh = await requestCode(s.links[0].token, meta);
    await expect(verifyCode(s.links[0].token, fresh.devCode!, meta)).resolves.toMatchObject({ recipientId: s.links[0].recipientId });
  });

  it("rejects an expired code, and a code used twice", async () => {
    const s = await sentEnvelope(admin);
    const { devCode } = await requestCode(s.links[0].token, meta);
    await admin.recipient.update({ where: { id: s.links[0].recipientId }, data: { otpExpiresAt: new Date(Date.now() - 1000) } });
    await expect(verifyCode(s.links[0].token, devCode!, meta)).rejects.toThrow(/expired/);

    const s2 = await sentEnvelope(admin);
    const c = await requestCode(s2.links[0].token, meta);
    await verifyCode(s2.links[0].token, c.devCode!, meta);
    await expect(verifyCode(s2.links[0].token, c.devCode!, meta)).rejects.toThrow(/request a code/i);
  });
});

describe("session and consent", () => {
  it("a verified session unlocks only its own link", async () => {
    const s = await sentEnvelope(admin, { signers: 2, sameStep: true });
    const a = await verified(s.links[0].token);
    const b = await verified(s.links[1].token);
    await expect(requireSignerSession(s.links[0].token, signerSessionValue(a.recipientId, a.verifiedAt))).resolves.toBeTruthy();
    await expect(requireSignerSession(s.links[0].token, signerSessionValue(b.recipientId, b.verifiedAt))).rejects.toThrow(/verify/i);
    await expect(requireSignerSession(s.links[0].token, undefined)).rejects.toThrow(/verify/i);
  });

  it("requires consent before showing the document, then shows only my fields", async () => {
    const s = await sentEnvelope(admin, { signers: 2, sameStep: true });
    const a = await verified(s.links[0].token);
    const session = signerSessionValue(a.recipientId, a.verifiedAt);
    await expect(getSigningView(s.links[0].token, session)).rejects.toThrow(/consent/);
    await giveConsent(s.links[0].token, session, meta);
    expect(await events(s.tenantId, s.envelopeId)).toContain("consented");
    const view = await getSigningView(s.links[0].token, session);
    expect(view.title).toBe("Service Agreement");
    expect(view.pdfUrl).toContain("/doc/");
    expect(view.fields.map((f) => f.type).sort()).toEqual(["date", "signature"]);
    expect((await openLink(s.links[0].token, meta)).consented).toBe(true);
  });
});
