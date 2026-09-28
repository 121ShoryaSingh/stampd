import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminDb, insertUser } from "../../../tests/helpers/db";
import { makePdf } from "../../../tests/helpers/pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject } from "@/server/storage/storage";
import { withTenant } from "@/server/db/context";
import { listAudit, verifyChain } from "@/server/audit/service";
import { hashToken } from "@/server/team/service";
import { createEnvelope, finalizeUpload, getEnvelope, uploadKeyFor, voidEnvelope } from "./service";
import { setRecipients } from "./recipients";
import { saveFields } from "./fields";
import { sendEnvelope } from "./send";

const admin = adminDb();
let tenantId: string, userId: string;
const opts = { expiresInDays: 30, reminderEveryDays: 3 };

beforeAll(async () => {
  userId = (await insertUser(admin)).id;
  ({ id: tenantId } = await createTenant({ userId, name: "Send Co" }));
});
afterAll(async () => {
  await admin.$disconnect();
});

async function ready({ withFields = true } = {}) {
  const { id } = await createEnvelope({ tenantId, userId, title: "Contract" });
  const key = uploadKeyFor(tenantId, id);
  await putObject(key, await makePdf(1), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId: id, key, filename: "c.pdf" });
  const recs = await setRecipients({
    tenantId, userId, envelopeId: id,
    recipients: [
      { name: "A", email: "a@x.dev", role: "signer", routingOrder: 1 },
      { name: "B", email: "b@x.dev", role: "signer", routingOrder: 2 },
      { name: "C", email: "c@x.dev", role: "cc", routingOrder: 1 },
    ],
  });
  if (withFields) {
    await saveFields({
      tenantId, userId, envelopeId: id,
      fields: [
        { recipientId: recs[0].id, type: "signature", page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.06 },
        { recipientId: recs[1].id, type: "signature", page: 1, x: 0.5, y: 0.8, w: 0.3, h: 0.06 },
      ],
    });
  }
  return id;
}

describe("sendEnvelope", () => {
  it("sends: status, expiry, first routing step, hashed tokens, audit", async () => {
    const id = await ready();
    const links = await sendEnvelope({ tenantId, userId, envelopeId: id, ...opts });
    expect(links.map((l) => l.email).sort()).toEqual(["a@x.dev", "b@x.dev", "c@x.dev"]);
    const { envelope, recipients } = await getEnvelope(tenantId, id);
    expect(envelope.status).toBe("sent");
    expect(envelope.expiresAt!.getTime() - envelope.sentAt!.getTime()).toBe(30 * 86_400_000);
    expect(Object.fromEntries(recipients.map((r) => [r.email, r.status]))).toEqual({ "a@x.dev": "sent", "b@x.dev": "pending", "c@x.dev": "pending" });
    const token = links.find((l) => l.email === "a@x.dev")!.url.split("/sign/")[1];
    expect(recipients.find((r) => r.email === "a@x.dev")!.tokenHash).toBe(hashToken(token));
    const events = await withTenant(tenantId, (tx) => listAudit(tx, id));
    expect(events.at(-1)!.event).toBe("sent");
    expect((await withTenant(tenantId, (tx) => verifyChain(tx, id))).ok).toBe(true);
  });

  it("sends only once when clicked twice at the same time", async () => {
    const id = await ready();
    const results = await Promise.allSettled([
      sendEnvelope({ tenantId, userId, envelopeId: id, ...opts }),
      sendEnvelope({ tenantId, userId, envelopeId: id, ...opts }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/already sent/);
  });

  it("refuses to send without a document, or a signature field per signer", async () => {
    const { id: noDoc } = await createEnvelope({ tenantId, userId, title: "Empty" });
    await expect(sendEnvelope({ tenantId, userId, envelopeId: noDoc, ...opts })).rejects.toThrow(/upload a PDF/i);
    const noFields = await ready({ withFields: false });
    await expect(sendEnvelope({ tenantId, userId, envelopeId: noFields, ...opts })).rejects.toThrow(/a@x.dev.*signature/);
  });

  it("validates expiry and reminder options", async () => {
    const id = await ready();
    await expect(sendEnvelope({ tenantId, userId, envelopeId: id, expiresInDays: 0, reminderEveryDays: null })).rejects.toThrow(/expire/i);
    await expect(sendEnvelope({ tenantId, userId, envelopeId: id, expiresInDays: 30, reminderEveryDays: 31 })).rejects.toThrow(/remind/i);
  });

  it("can void a sent envelope, not twice", async () => {
    const id = await ready();
    await sendEnvelope({ tenantId, userId, envelopeId: id, ...opts });
    await voidEnvelope({ tenantId, userId, envelopeId: id, reason: "Wrong terms" });
    expect((await getEnvelope(tenantId, id)).envelope).toMatchObject({ status: "voided", voidReason: "Wrong terms" });
    await expect(voidEnvelope({ tenantId, userId, envelopeId: id, reason: "again" })).rejects.toThrow(/only sent/i);
  });
});
