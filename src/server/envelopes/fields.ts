import "server-only";
import { withTenant } from "@/server/db/context";
import type { FieldType } from "@/server/db/types";
import { appendAudit } from "@/server/audit/service";
import { ValidationError } from "@/server/errors";
import { isValidBox } from "@/lib/fields/geometry";
import { lockDraft } from "./service";

export const MAX_FIELDS = 500;
export const FIELD_TYPES: FieldType[] = ["signature", "initials", "date", "text", "checkbox", "choice"];

// Shared placement rules for envelope and preset fields.
export function checkFieldPlacement(f: { type: FieldType; page: number; x: number; y: number; w: number; h: number }, pageCount: number) {
  if (!FIELD_TYPES.includes(f.type)) throw new ValidationError(`Unknown field type ${f.type}`);
  if (!Number.isInteger(f.page) || f.page < 1 || f.page > pageCount) throw new ValidationError(`The document has no page ${f.page}`);
  if (!isValidBox(f)) throw new ValidationError("A field is outside the page");
}
export type FieldInput = { recipientId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number; required?: boolean };

export async function saveFields(i: { tenantId: string; userId: string; envelopeId: string; fields: FieldInput[] }) {
  if (i.fields.length > MAX_FIELDS) throw new ValidationError(`At most ${MAX_FIELDS} fields per envelope`);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const doc = await tx.document.findUnique({ where: { envelopeId: i.envelopeId } });
    if (!doc) throw new ValidationError("Upload a PDF before placing fields");
    const recs = new Map((await tx.recipient.findMany({ where: { envelopeId: i.envelopeId } })).map((r) => [r.id, r]));
    const rows = i.fields.map((f) => {
      checkFieldPlacement(f, doc.pageCount);
      const rec = recs.get(f.recipientId);
      if (!rec) throw new ValidationError("A field is assigned to a recipient who is not on this envelope");
      if (rec.role === "cc") throw new ValidationError(`${rec.email} is cc only and cannot have fields`);
      return {
        tenantId: i.tenantId,
        envelopeId: i.envelopeId,
        documentId: doc.id,
        recipientId: f.recipientId,
        type: f.type,
        page: f.page,
        x: f.x,
        y: f.y,
        w: f.w,
        h: f.h,
        required: f.required ?? f.type !== "checkbox",
      };
    });
    await tx.field.deleteMany({ where: { envelopeId: i.envelopeId } });
    if (rows.length) await tx.field.createMany({ data: rows });
    await appendAudit(tx, {
      tenantId: i.tenantId,
      envelopeId: i.envelopeId,
      actorType: "user",
      actorId: i.userId,
      event: "fields_updated",
      data: { count: rows.length },
    });
    return rows.length;
  });
}
