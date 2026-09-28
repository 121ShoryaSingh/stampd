import { insertUser, type AdminDb } from "./db";
import { makePdf } from "./pdf";
import { createTenant } from "@/server/tenants/service";
import { putObject } from "@/server/storage/storage";
import { createEnvelope, finalizeUpload, uploadKeyFor } from "@/server/envelopes/service";
import { setRecipients } from "@/server/envelopes/recipients";
import { saveFields } from "@/server/envelopes/fields";
import { sendEnvelope } from "@/server/envelopes/send";
import { tokenFor } from "./mail";

// A sent envelope with N signers (s1@x.dev...), each with a signature and a date field.
// links[i].token is null until that signer's step starts; then use tokenFor().
export async function sentEnvelope(admin: AdminDb, opts: { signers?: number; sameStep?: boolean; withText?: boolean } = {}) {
  const n = opts.signers ?? 1;
  const userId = (await insertUser(admin)).id;
  const { id: tenantId } = await createTenant({ userId, name: "Signing Co" });
  const { id: envelopeId } = await createEnvelope({ tenantId, userId, title: "Service Agreement" });
  const key = uploadKeyFor(tenantId, envelopeId);
  await putObject(key, await makePdf(1), "application/pdf");
  await finalizeUpload({ tenantId, userId, envelopeId, key, filename: "sa.pdf" });
  const recs = await setRecipients({
    tenantId,
    userId,
    envelopeId,
    recipients: Array.from({ length: n }, (_, i) => ({
      name: `Signer ${i + 1}`,
      email: `s${i + 1}@x.dev`,
      role: "signer" as const,
      routingOrder: opts.sameStep ? 1 : i + 1,
    })),
  });
  await saveFields({
    tenantId,
    userId,
    envelopeId,
    fields: recs.flatMap((r, i) => [
      { recipientId: r.id, type: "signature" as const, page: 1, x: 0.1, y: 0.1 + i * 0.2, w: 0.3, h: 0.06 },
      { recipientId: r.id, type: "date" as const, page: 1, x: 0.5, y: 0.1 + i * 0.2, w: 0.2, h: 0.03 },
      ...(opts.withText ? [{ recipientId: r.id, type: "text" as const, page: 1, x: 0.1, y: 0.18 + i * 0.2, w: 0.3, h: 0.03 }] : []),
    ]),
  });
  await sendEnvelope({ tenantId, userId, envelopeId, expiresInDays: 30, reminderEveryDays: null });
  const links = [];
  for (const r of recs) links.push({ email: r.email, recipientId: r.id, token: await tokenFor(admin, r.id) });
  return { tenantId, envelopeId, userId, links };
}
