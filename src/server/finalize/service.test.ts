import { describe, it, expect, afterAll } from "vitest";
import { PDFDocument } from "pdf-lib";
import { adminDb } from "../../../tests/helpers/db";
import { sentEnvelope, signFor } from "../../../tests/helpers/signing";
import { tokenFor } from "../../../tests/helpers/mail";
import { visibleText } from "../../../tests/helpers/pdfjs";
import { makePdf } from "../../../tests/helpers/pdf";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import { getObjectBytes, putObject } from "@/server/storage/storage";
import { processDueFinalizations, retryFinalize, SEAL_MAX_ATTEMPTS } from "./service";
import { verifySeal } from "./verify";

const admin = adminDb();
afterAll(async () => {
  await admin.$disconnect();
});

const events = (tenantId: string, envelopeId: string) => withTenant(tenantId, (tx) => listAudit(tx, envelopeId)).then((r) => r.map((e) => e.event));

// Two signers in one step plus a cc, all signed.
async function completed() {
  const s = await sentEnvelope(admin, { signers: 2, sameStep: true, withText: true, cc: true });
  for (const l of s.links) {
    const fields = await admin.field.findMany({ where: { recipientId: l.recipientId, type: "text" } });
    await signFor(admin, l.token!, Object.fromEntries(fields.map((f) => [f.id, `Acme for ${l.email}`])));
  }
  return s;
}

describe("processDueFinalizations", () => {
  it("seals a completed envelope and emails everyone their copy", async () => {
    const s = await completed();
    expect(await processDueFinalizations({ tenantId: s.tenantId })).toEqual({ sealed: 1, failed: 0, retried: 0 });

    const env = await admin.envelope.findUniqueOrThrow({ where: { id: s.envelopeId } });
    expect(env).toMatchObject({ status: "completed", sealRunAt: null, lastError: null, sealLockedUntil: null });
    expect(env.sealedS3Key).toMatch(/\/sealed\/[0-9a-f-]{36}\/service-agreement-signed\.pdf$/);
    const bytes = Buffer.from(await getObjectBytes(env.sealedS3Key!));
    expect(verifySeal(bytes)).toMatchObject({ valid: true });
    const { createHash } = await import("node:crypto");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(env.sealedSha256);

    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2); // original page + certificate
    const text = await visibleText(bytes);
    expect(text.filter((t) => t.page === 1).map((t) => t.str)).toEqual(expect.arrayContaining(["Acme for s1@x.dev", "Acme for s2@x.dev", new Date().toISOString().slice(0, 10)]));
    const cert = text.filter((t) => t.page > 1).map((t) => t.str).join("\n");
    for (const needle of ["Certificate of completion", "Signer 1 <s1@x.dev>", "Signer 2 <s2@x.dev>", "Carl Copy <cc@x.dev>", "203.0.113.50"]) expect(cert).toContain(needle);

    expect(await events(s.tenantId, s.envelopeId)).toContain("sealed");
    const jobs = await admin.emailJob.findMany({ where: { envelopeId: s.envelopeId, kind: { in: ["completed", "signed_copy"] } } });
    const sender = await admin.user.findUniqueOrThrow({ where: { id: s.userId } });
    expect(jobs.map((j) => `${j.kind}:${j.toEmail}`).sort()).toEqual([`completed:${sender.email}`, "signed_copy:cc@x.dev", "signed_copy:s1@x.dev", "signed_copy:s2@x.dev"].sort());
    expect((jobs[0].data as { url: string }).url).toContain("service-agreement-signed.pdf");

    // Nothing left to do.
    expect(await processDueFinalizations({ tenantId: s.tenantId })).toEqual({ sealed: 0, failed: 0, retried: 0 });
  });

  it("seals once when two workers run at the same time", async () => {
    const s = await completed();
    const [a, b] = await Promise.all([processDueFinalizations({ tenantId: s.tenantId }), processDueFinalizations({ tenantId: s.tenantId })]);
    expect(a.sealed + b.sealed).toBe(1);
    expect((await events(s.tenantId, s.envelopeId)).filter((e) => e === "sealed")).toHaveLength(1);
    expect(await admin.emailJob.count({ where: { envelopeId: s.envelopeId, kind: "completed" } })).toBe(1);
  });

  it("retries with backoff, gives up after the last try, and can be retried by the sender", async () => {
    const s = await completed();
    const doc = await admin.document.findUniqueOrThrow({ where: { envelopeId: s.envelopeId } });
    const original = await getObjectBytes(doc.s3Key);
    await putObject(doc.s3Key, await makePdf(2), "application/pdf"); // storage no longer matches the hash

    let t = Date.now();
    const now = () => new Date(t);
    for (let i = 1; i < SEAL_MAX_ATTEMPTS; i++) {
      expect(await processDueFinalizations({ tenantId: s.tenantId, now })).toEqual({ sealed: 0, failed: 0, retried: 1 });
      const env = await admin.envelope.findUniqueOrThrow({ where: { id: s.envelopeId } });
      expect(env.lastError).toMatch(/no longer matches/);
      expect(env.sealRunAt!.getTime() - t).toBe(i === 1 ? 60_000 : 300_000);
      expect((await processDueFinalizations({ tenantId: s.tenantId, now })).retried).toBe(0); // not due yet
      t = env.sealRunAt!.getTime();
    }
    expect(await processDueFinalizations({ tenantId: s.tenantId, now })).toEqual({ sealed: 0, failed: 1, retried: 0 });
    const gaveUp = await admin.envelope.findUniqueOrThrow({ where: { id: s.envelopeId } });
    expect(gaveUp).toMatchObject({ sealRunAt: null, sealedS3Key: null, sealAttempts: SEAL_MAX_ATTEMPTS });
    expect(await events(s.tenantId, s.envelopeId)).toContain("seal_failed");

    await putObject(doc.s3Key, original, "application/pdf");
    await retryFinalize({ tenantId: s.tenantId, userId: s.userId, envelopeId: s.envelopeId });
    await expect(retryFinalize({ tenantId: s.tenantId, userId: s.userId, envelopeId: s.envelopeId })).rejects.toThrow(/not waiting/);
    expect(await processDueFinalizations({ tenantId: s.tenantId })).toMatchObject({ sealed: 1 });
    expect(await events(s.tenantId, s.envelopeId)).toEqual(expect.arrayContaining(["seal_retried", "sealed"]));
  });

  it("leaves envelopes that are not completed alone", async () => {
    const s = await sentEnvelope(admin, { signers: 2 });
    await signFor(admin, s.links[0].token!);
    expect(await tokenFor(admin, s.links[1].recipientId)).toBeTruthy();
    expect(await processDueFinalizations({ tenantId: s.tenantId })).toEqual({ sealed: 0, failed: 0, retried: 0 });
    await expect(retryFinalize({ tenantId: s.tenantId, userId: s.userId, envelopeId: s.envelopeId })).rejects.toThrow(/not waiting/);
  });
});
