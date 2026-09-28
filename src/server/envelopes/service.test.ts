import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { adminDb, insertUser } from "../../../tests/helpers/db";
import { makePdf, brokenPagePdf, rotatedAndCroppedPdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject, objectExists } from "@/server/storage/storage";
import { withTenant } from "@/server/db/context";
import { listAudit } from "@/server/audit/service";
import {
  createEnvelope,
  createUploadUrl,
  finalizeUpload,
  getEnvelope,
  listEnvelopes,
  countByStatus,
  deleteDraft,
  voidEnvelope,
  uploadKeyFor,
} from "./service";

const admin = adminDb();
let tenantId: string, otherTenant: string, userId: string;

beforeAll(async () => {
  userId = (await insertUser(admin)).id;
  ({ id: tenantId } = await createTenant({ userId, name: "Env Co" }));
  ({ id: otherTenant } = await createTenant({ userId, name: "Other Co" }));
});
afterAll(async () => {
  await admin.$disconnect();
});

async function uploaded(pages = 2) {
  const { id } = await createEnvelope({ tenantId, userId, title: "NDA" });
  const key = uploadKeyFor(tenantId, id);
  await putObject(key, await makePdf(pages), "application/pdf");
  return { id, key };
}

describe("envelope drafts", () => {
  it("creates a draft and logs 'created'", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "  Lease  " });
    const { envelope } = await getEnvelope(tenantId, id);
    expect(envelope).toMatchObject({ title: "Lease", status: "draft" });
    const events = await withTenant(tenantId, (tx) => listAudit(tx, id));
    expect(events.map((e) => e.event)).toEqual(["created"]);
  });

  it("rejects an empty title", async () => {
    await expect(createEnvelope({ tenantId, userId, title: "   " })).rejects.toThrow(/title/i);
  });

  it("presigns an upload scoped to the envelope", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "T" });
    const { key, url } = await createUploadUrl({ tenantId, envelopeId: id });
    expect(key.startsWith(`t/${tenantId}/e/${id}/`)).toBe(true);
    expect(url).toContain(key);
  });

  it("finalizes a real PDF: page count, sizes, hash, audit", async () => {
    const { id, key } = await uploaded(3);
    const res = await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "nda.pdf" });
    expect(res.pageCount).toBe(3);
    const { document } = await getEnvelope(tenantId, id);
    expect(document).toMatchObject({ filename: "nda.pdf", pageCount: 3, pageSizes: [{ w: 612, h: 792 }, { w: 612, h: 792 }, { w: 612, h: 792 }] });
    expect(document!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const events = await withTenant(tenantId, (tx) => listAudit(tx, id));
    expect(events.map((e) => e.event)).toContain("document_uploaded");
  });

  it("replaces the document when uploading again and deletes the old file", async () => {
    const { id, key } = await uploaded(1);
    await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "a.pdf" });
    const firstDocKey = (await getEnvelope(tenantId, id)).document!.s3Key;
    const key2 = uploadKeyFor(tenantId, id);
    await putObject(key2, await makePdf(4), "application/pdf");
    await finalizeUpload({ tenantId, userId, envelopeId: id, key: key2, filename: "b.pdf" });
    expect((await getEnvelope(tenantId, id)).document).toMatchObject({ filename: "b.pdf", pageCount: 4 });
    expect(await objectExists(firstDocKey)).toBe(false);
  });

  it("moves the verified PDF to a server-only key and removes the upload", async () => {
    const { id, key } = await uploaded(1);
    await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "a.pdf" });
    const { document } = await getEnvelope(tenantId, id);
    expect(document!.s3Key).toMatch(new RegExp(`^t/${tenantId}/e/${id}/doc/[0-9a-f-]{36}\\.pdf$`));
    expect(await objectExists(document!.s3Key)).toBe(true);
    expect(await objectExists(key)).toBe(false);
  });

  it("finalizing the same upload twice keeps the document intact", async () => {
    const { id, key } = await uploaded(1);
    await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "a.pdf" });
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "a.pdf" })).rejects.toThrow(/did not finish/);
    const { document } = await getEnvelope(tenantId, id);
    expect(await objectExists(document!.s3Key)).toBe(true);
  });

  it("rejects a PDF whose page tree is broken with a clear message", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Broken tree" });
    const key = uploadKeyFor(tenantId, id);
    await putObject(key, await brokenPagePdf(), "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "b.pdf" })).rejects.toThrow(/not a valid PDF/);
  });

  it("stores the visible size of rotated and cropped pages", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Rotated" });
    const key = uploadKeyFor(tenantId, id);
    await putObject(key, await rotatedAndCroppedPdf(), "application/pdf");
    await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "r.pdf" });
    expect((await getEnvelope(tenantId, id)).document!.pageSizes).toEqual([
      { w: 792, h: 612, rotate: 90 },
      { w: 300, h: 400, rotate: 0 },
    ]);
  });

  it("rejects a file over 25 MB and deletes it", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Huge" });
    const key = uploadKeyFor(tenantId, id);
    const big = new Uint8Array(26_214_401);
    big.set(new TextEncoder().encode("%PDF-"));
    await putObject(key, big, "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "big.pdf" })).rejects.toThrow(/25 MB/);
    expect(await objectExists(key)).toBe(false);
  });

  it("gives a clear error when the upload never reached storage", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Ghost" });
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key: uploadKeyFor(tenantId, id), filename: "g.pdf" })).rejects.toThrow(
      /did not finish/,
    );
  });

  it("rejects bytes that are not a PDF, leaving no document", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Bad" });
    const key = uploadKeyFor(tenantId, id);
    await putObject(key, new TextEncoder().encode("hello, I am a text file"), "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "x.pdf" })).rejects.toThrow(/not a valid PDF/);
    expect((await getEnvelope(tenantId, id)).document).toBeNull();
    expect(await objectExists(key)).toBe(false);
  });

  it("rejects a truncated PDF", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Trunc" });
    const key = uploadKeyFor(tenantId, id);
    await putObject(key, (await makePdf(2)).slice(0, 40), "application/pdf");
    await expect(finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "t.pdf" })).rejects.toThrow(/not a valid PDF/);
  });

  it("rejects an upload key for another envelope or workspace", async () => {
    const a = await uploaded(1);
    const { id: b } = await createEnvelope({ tenantId, userId, title: "B" });
    await expect(finalizeUpload({ tenantId, userId, envelopeId: b, key: a.key, filename: "x.pdf" })).rejects.toThrow(/upload/i);
    const foreign = `t/${otherTenant}/e/${a.id}/${randomUUID()}.pdf`;
    await expect(finalizeUpload({ tenantId, userId, envelopeId: a.id, key: foreign, filename: "x.pdf" })).rejects.toThrow(/upload/i);
  });

  it("cannot read another workspace's envelope", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Private" });
    await expect(getEnvelope(otherTenant, id)).rejects.toThrow(/not found/i);
  });

  it("lists envelopes with status filter and counts", async () => {
    const { id } = await createEnvelope({ tenantId: otherTenant, userId, title: "Listed" });
    const all = await listEnvelopes(otherTenant);
    expect(all.find((e) => e.id === id)).toMatchObject({ title: "Listed", status: "draft", recipientCount: 0, signedCount: 0 });
    expect(await listEnvelopes(otherTenant, { status: "sent" })).toHaveLength(0);
    expect((await countByStatus(otherTenant)).draft).toBeGreaterThanOrEqual(1);
  });

  it("deletes drafts but refuses to void a draft", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "Gone" });
    await expect(voidEnvelope({ tenantId, userId, envelopeId: id, reason: "x" })).rejects.toThrow(/only sent/i);
    await deleteDraft({ tenantId, envelopeId: id });
    await expect(getEnvelope(tenantId, id)).rejects.toThrow(/not found/i);
  });
});
