import { describe, it, expect, afterAll } from "vitest";
import { adminDb } from "../../../tests/helpers/db";
import { sentEnvelope } from "../../../tests/helpers/signing";
import { withTenant } from "@/server/db/context";
import { listAudit, verifyChain } from "@/server/audit/service";
import { objectExists } from "@/server/storage/storage";
import { requestCode, verifyCode, giveConsent, getSigningView } from "./service";
import { signerSessionValue } from "./session";
import { submitSigning, declineSigning } from "./submit";
import { decodePng } from "./png";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

const meta = { ip: "203.0.113.9", userAgent: "vitest" };
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (bytes = 64) => `data:image/png;base64,${Buffer.from([...PNG_MAGIC, ...new Array(bytes).fill(1)]).toString("base64")}`;

// Verifies the code and consents; returns the session value for this signer.
async function ready(token: string) {
  const { devCode } = await requestCode(token, meta);
  const v = await verifyCode(token, devCode!, meta);
  const session = signerSessionValue(v.recipientId, v.verifiedAt);
  await giveConsent(token, session, meta);
  return session;
}

async function sign(token: string, extra: Record<string, string> = {}) {
  const session = await ready(token);
  return submitSigning(token, session, { values: extra, signaturePng: png() }, meta);
}

describe("decodePng", () => {
  it("accepts a PNG data URL and rejects others", () => {
    expect(decodePng(png())[0]).toBe(0x89);
    expect(() => decodePng("data:image/jpeg;base64,AAAA")).toThrow(/PNG/);
    expect(() => decodePng(`data:image/png;base64,${Buffer.from("not png").toString("base64")}`)).toThrow(/PNG/);
    expect(() => decodePng(png(300_001))).toThrow(/too large/);
  });
});

describe("submitSigning", () => {
  it("one signer: stores the signature, fills the date, completes the envelope", async () => {
    const s = await sentEnvelope(admin);
    const res = await sign(s.links[0].token);
    expect(res).toEqual({ envelopeStatus: "completed", nextStepStarted: false });

    const rec = await admin.recipient.findUniqueOrThrow({ where: { id: s.links[0].recipientId } });
    expect(rec).toMatchObject({ status: "signed", signIp: meta.ip, signUserAgent: meta.userAgent });
    const fields = await admin.field.findMany({ where: { recipientId: rec.id } });
    const sig = fields.find((f) => f.type === "signature")!;
    expect(sig.signatureS3Key).toMatch(/\/sig\//);
    expect(await objectExists(sig.signatureS3Key!)).toBe(true);
    expect(fields.find((f) => f.type === "date")!.value).toBe(new Date().toISOString().slice(0, 10));

    const env = await admin.envelope.findUniqueOrThrow({ where: { id: s.envelopeId } });
    expect(env.status).toBe("completed");
    expect(env.completedAt).toBeInstanceOf(Date);
    const events = await withTenant(s.tenantId, (tx) => listAudit(tx, s.envelopeId));
    expect(events.slice(-2).map((e) => e.event)).toEqual(["signed", "completed"]);
    expect((await withTenant(s.tenantId, (tx) => verifyChain(tx, s.envelopeId))).ok).toBe(true);
  });

  it("two signers in order: the second step starts after the first signs", async () => {
    const s = await sentEnvelope(admin, { signers: 2 });
    expect(await sign(s.links[0].token)).toEqual({ envelopeStatus: "sent", nextStepStarted: true });
    expect((await admin.recipient.findUniqueOrThrow({ where: { id: s.links[1].recipientId } })).status).toBe("sent");
    const events = await withTenant(s.tenantId, (tx) => listAudit(tx, s.envelopeId));
    expect(events.map((e) => e.event)).toContain("step_started");
    expect(await sign(s.links[1].token)).toEqual({ envelopeStatus: "completed", nextStepStarted: false });
  });

  it("two signers in the same step: completes only after both", async () => {
    const s = await sentEnvelope(admin, { signers: 2, sameStep: true });
    expect((await sign(s.links[0].token)).envelopeStatus).toBe("sent");
    expect((await sign(s.links[1].token)).envelopeStatus).toBe("completed");
  });

  it("records one signature when submitted twice at once", async () => {
    const s = await sentEnvelope(admin);
    const session = await ready(s.links[0].token);
    const input = { values: {}, signaturePng: png() };
    const results = await Promise.allSettled([
      submitSigning(s.links[0].token, session, input, meta),
      submitSigning(s.links[0].token, session, input, meta),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/already signed/);
    const events = await withTenant(s.tenantId, (tx) => listAudit(tx, s.envelopeId));
    expect(events.filter((e) => e.event === "signed")).toHaveLength(1);
  });

  it("requires a signature image and validates it", async () => {
    const s = await sentEnvelope(admin);
    const session = await ready(s.links[0].token);
    await expect(submitSigning(s.links[0].token, session, { values: {} }, meta)).rejects.toThrow(/signature/i);
    await expect(submitSigning(s.links[0].token, session, { values: {}, signaturePng: "data:image/gif;base64,R0lG" }, meta)).rejects.toThrow(/PNG/);
    await expect(submitSigning(s.links[0].token, session, { values: {}, signaturePng: png(300_001) }, meta)).rejects.toThrow(/too large/);
  });

  it("rejects values for fields that are not mine, long text, and missing required text", async () => {
    const s = await sentEnvelope(admin, { signers: 2, sameStep: true, withText: true });
    const sessionA = await ready(s.links[0].token);
    const sessionB = await ready(s.links[1].token);
    const mine = (await getSigningView(s.links[0].token, sessionA)).fields.find((f) => f.type === "text")!;
    const theirs = (await getSigningView(s.links[1].token, sessionB)).fields.find((f) => f.type === "text")!;
    const base = { signaturePng: png() };
    await expect(submitSigning(s.links[0].token, sessionA, { ...base, values: { [mine.id]: "ok", [theirs.id]: "x" } }, meta)).rejects.toThrow(/not yours/);
    await expect(submitSigning(s.links[0].token, sessionA, { ...base, values: { [mine.id]: "x".repeat(501) } }, meta)).rejects.toThrow(/500/);
    await expect(submitSigning(s.links[0].token, sessionA, { ...base, values: {} }, meta)).rejects.toThrow(/required/);
    await expect(submitSigning(s.links[0].token, sessionA, { ...base, values: { [mine.id]: "Acme Ltd" } }, meta)).resolves.toBeTruthy();
    expect((await admin.field.findUniqueOrThrow({ where: { id: mine.id } })).value).toBe("Acme Ltd");
  });
});

describe("declineSigning", () => {
  it("declines with a reason and closes the envelope for everyone", async () => {
    const s = await sentEnvelope(admin, { signers: 2, sameStep: true });
    const session = await ready(s.links[0].token);
    await expect(declineSigning(s.links[0].token, session, "  ", meta)).rejects.toThrow(/reason/);
    await declineSigning(s.links[0].token, session, "Wrong amount", meta);
    expect(await admin.recipient.findUniqueOrThrow({ where: { id: s.links[0].recipientId } })).toMatchObject({ status: "declined", declineReason: "Wrong amount" });
    expect((await admin.envelope.findUniqueOrThrow({ where: { id: s.envelopeId } })).status).toBe("declined");
    const other = await ready(s.links[1].token).catch((e) => e);
    expect(String(other)).toMatch(/closed/);
  });
});
