import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject } from "@/server/storage/storage";
import { createEnvelope, finalizeUpload, getEnvelope, uploadKeyFor } from "./service";
import { setRecipients } from "./recipients";
import { saveFields } from "./fields";

const admin = adminDb();
let tenantId: string, userId: string;

beforeAll(async () => {
  userId = (await insertUser(admin)).id;
  ({ id: tenantId } = await createTenant({ userId, name: "Edit Co" }));
});
afterAll(async () => {
  await admin.$disconnect();
});

async function draftWithPdf(pages = 2) {
  const { id } = await createEnvelope({ tenantId, userId, title: "Doc" });
  const key = uploadKeyFor(tenantId, id);
  await putObject(key, await makePdf(pages), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "d.pdf" });
  return id;
}

const alice = { name: "Alice", email: "Alice@Example.com ", role: "signer" as const, routingOrder: 1 };
const bob = { name: "Bob", email: "bob@example.com", role: "signer" as const, routingOrder: 2 };
const sig = (recipientId: string, over: Partial<{ page: number; x: number; y: number; w: number; h: number }> = {}) => ({
  recipientId, type: "signature" as const, page: 1, x: 0.1, y: 0.1, w: 0.3, h: 0.06, ...over,
});

describe("recipients", () => {
  it("saves recipients with normalized emails and keeps ids stable on re-save", async () => {
    const id = await draftWithPdf();
    const first = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice, bob] });
    expect(first.map((r) => r.email)).toEqual(["alice@example.com", "bob@example.com"]);
    const second = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, name: "Alice B" }] });
    expect(second[0].id).toBe(first[0].id);
    expect((await getEnvelope(tenantId, id)).recipients.map((r) => r.name)).toEqual(["Alice B"]);
  });

  it("switching a signer to cc removes their fields", async () => {
    const id = await draftWithPdf(1);
    const [a, b] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice, bob] });
    await saveFields({ tenantId, userId, envelopeId: id, fields: [sig(a.id), sig(b.id, { y: 0.5 })] });
    await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice, { ...bob, role: "cc" }] });
    expect((await getEnvelope(tenantId, id)).fields.map((f) => f.recipientId)).toEqual([a.id]);
  });

  it("rejects duplicate emails (case-insensitive)", async () => {
    const id = await draftWithPdf();
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice, { ...bob, email: "ALICE@example.com" }] })).rejects.toThrow(
      /more than once/,
    );
  });

  it("rejects bad input: no name, bad email, bad order, too many", async () => {
    const id = await draftWithPdf();
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, name: " " }] })).rejects.toThrow(/name/i);
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, email: "nope" }] })).rejects.toThrow(/valid email/);
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [{ ...alice, routingOrder: 0 }] })).rejects.toThrow(/order/i);
    const many = Array.from({ length: 21 }, (_, i) => ({ ...alice, email: `p${i}@x.dev` }));
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: many })).rejects.toThrow(/20/);
  });
});

describe("fields", () => {
  it("replaces fields and validates them", async () => {
    const id = await draftWithPdf(2);
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    const n = await saveFields({
      tenantId, userId, envelopeId: id,
      fields: [sig(a.id, { y: 0.8 }), { recipientId: a.id, type: "date", page: 2, x: 0.5, y: 0.8, w: 0.2, h: 0.03 }],
    });
    expect(n).toBe(2);
    await saveFields({ tenantId, userId, envelopeId: id, fields: [{ recipientId: a.id, type: "text", page: 1, x: 0, y: 0, w: 0.2, h: 0.03 }] });
    expect((await getEnvelope(tenantId, id)).fields.map((f) => f.type)).toEqual(["text"]);
  });

  it("rejects a field off the page or on a missing page", async () => {
    const id = await draftWithPdf(2);
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    await expect(saveFields({ tenantId, userId, envelopeId: id, fields: [sig(a.id, { x: 0.9 })] })).rejects.toThrow(/outside the page/);
    await expect(saveFields({ tenantId, userId, envelopeId: id, fields: [sig(a.id, { page: 3 })] })).rejects.toThrow(/page 3/);
  });

  it("rejects a field for a recipient of another envelope, or for a cc", async () => {
    const id1 = await draftWithPdf(1);
    const id2 = await draftWithPdf(1);
    const [other] = await setRecipients({ tenantId, userId, envelopeId: id2, recipients: [alice] });
    await expect(saveFields({ tenantId, userId, envelopeId: id1, fields: [sig(other.id)] })).rejects.toThrow(/recipient/i);
    const [cc] = await setRecipients({ tenantId, userId, envelopeId: id1, recipients: [{ ...bob, role: "cc" }] });
    await expect(saveFields({ tenantId, userId, envelopeId: id1, fields: [sig(cc.id)] })).rejects.toThrow(/cc/i);
  });

  it("requires a document before fields can be placed", async () => {
    const { id } = await createEnvelope({ tenantId, userId, title: "No doc" });
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    await expect(saveFields({ tenantId, userId, envelopeId: id, fields: [sig(a.id)] })).rejects.toThrow(/upload a PDF/i);
  });

  it("rejects edits after the envelope is sent", async () => {
    const id = await draftWithPdf(1);
    const [a] = await setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] });
    await admin.envelope.update({ where: { id }, data: { status: "sent" } });
    await expect(setRecipients({ tenantId, userId, envelopeId: id, recipients: [alice] })).rejects.toThrow(/already sent/);
    await expect(saveFields({ tenantId, userId, envelopeId: id, fields: [sig(a.id)] })).rejects.toThrow(/already sent/);
  });
});
