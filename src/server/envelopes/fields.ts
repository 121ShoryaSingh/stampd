import "server-only";
import { withTenant } from "@/server/db/context";
import type { FieldType } from "@/server/db/types";
import { appendAudit } from "@/server/audit/service";
import { ValidationError } from "@/server/errors";
import { isValidBox } from "@/lib/fields/geometry";
import { CHOICE_MARKS, MAX_LABEL, MAX_OPTION, MAX_OPTIONS, type ChoiceMark } from "@/lib/fields/choice";
import { unsupportedChars } from "@/server/finalize/fonts";
import { lockDraft } from "./service";

export const MAX_FIELDS = 500;
export const FIELD_TYPES: FieldType[] = ["signature", "initials", "date", "text", "checkbox", "choice"];

// Shared placement rules for envelope and preset fields.
export function checkFieldPlacement(f: { type: FieldType; page: number; x: number; y: number; w: number; h: number }, pageCount: number) {
  if (!FIELD_TYPES.includes(f.type)) throw new ValidationError(`Unknown field type ${f.type}`);
  if (!Number.isInteger(f.page) || f.page < 1 || f.page > pageCount) throw new ValidationError(`The document has no page ${f.page}`);
  if (!isValidBox(f)) throw new ValidationError("A field is outside the page");
}
// Optional details every field may carry; choice answer boxes also need groupKey, option and mark.
export type FieldExtras = { required?: boolean; label?: string | null; groupKey?: string | null; option?: string | null; mark?: ChoiceMark | null };
export type FieldInput = { recipientId: string; type: FieldType; page: number; x: number; y: number; w: number; h: number } & FieldExtras;

const GROUP_KEY = /^[A-Za-z0-9_-]{1,64}$/;
const tidy = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();

// Cleans labels and checks choice questions: 2-10 answer boxes for one person, distinct answers, one mark style.
// "Required" and the question label are per question, so every box of a question gets the same values.
export function normalizeFields<T extends { type: FieldType } & FieldExtras>(fields: T[], personOf: (f: T) => string) {
  const rows = fields.map((f) => {
    const label = tidy(f.label) || null;
    if (label && label.length > MAX_LABEL) throw new ValidationError(`Field labels can have at most ${MAX_LABEL} characters`);
    if (f.type !== "choice") return { ...f, label, required: f.required ?? f.type !== "checkbox", groupKey: null, option: null, mark: null };
    if (!f.groupKey || !GROUP_KEY.test(f.groupKey)) throw new ValidationError("An answer box is not linked to a question");
    if (!f.mark || !CHOICE_MARKS.includes(f.mark)) throw new ValidationError("Choose how the chosen answer is marked");
    const option = tidy(f.option);
    if (!option) throw new ValidationError("Every answer box needs a label, for example Yes or No");
    if (option.length > MAX_OPTION) throw new ValidationError(`Answer labels can have at most ${MAX_OPTION} characters`);
    return { ...f, label, required: f.required ?? true, groupKey: f.groupKey, option, mark: f.mark };
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) if (r.groupKey) groups.set(r.groupKey, [...(groups.get(r.groupKey) ?? []), r]);
  for (const box of groups.values()) {
    const label = box.find((b) => b.label)?.label ?? null;
    const name = label ? `The question "${label}"` : "A choice question";
    if (box.length < 2) throw new ValidationError(`${name} needs at least two answer boxes`);
    if (box.length > MAX_OPTIONS) throw new ValidationError(`${name} can have at most ${MAX_OPTIONS} answer boxes`);
    if (new Set(box.map((b) => personOf(b as unknown as T))).size > 1) throw new ValidationError(`${name} has answer boxes for different signers`);
    if (new Set(box.map((b) => b.mark)).size > 1) throw new ValidationError(`${name} mixes mark styles`);
    const seen = new Set<string>();
    for (const b of box) {
      const k = b.option!.toLowerCase();
      if (seen.has(k)) throw new ValidationError(`${name} has two answers called "${b.option}"`);
      seen.add(k);
      // Only the "write the answer" style prints the label, so only then must the PDF font have it.
      const bad = b.mark === "text" ? unsupportedChars(b.option!) : [];
      if (bad.length) throw new ValidationError(`The answer "${b.option}" has characters the signed PDF cannot show: ${bad.slice(0, 5).join(" ")}`);
    }
    const required = box.some((b) => b.required);
    for (const b of box) Object.assign(b, { label, required });
  }
  return rows;
}

export async function saveFields(i: { tenantId: string; userId: string; envelopeId: string; fields: FieldInput[] }) {
  if (i.fields.length > MAX_FIELDS) throw new ValidationError(`At most ${MAX_FIELDS} fields per envelope`);
  return withTenant(i.tenantId, async (tx) => {
    await lockDraft(tx, i.envelopeId);
    const doc = await tx.document.findUnique({ where: { envelopeId: i.envelopeId } });
    if (!doc) throw new ValidationError("Upload a PDF before placing fields");
    const recs = new Map((await tx.recipient.findMany({ where: { envelopeId: i.envelopeId } })).map((r) => [r.id, r]));
    for (const f of i.fields) {
      checkFieldPlacement(f, doc.pageCount);
      const rec = recs.get(f.recipientId);
      if (!rec) throw new ValidationError("A field is assigned to a recipient who is not on this envelope");
      if (rec.role === "cc") throw new ValidationError(`${rec.email} is cc only and cannot have fields`);
    }
    const rows = normalizeFields(i.fields, (f) => f.recipientId).map((f) => ({
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
      required: f.required,
      label: f.label,
      groupKey: f.groupKey,
      option: f.option,
      mark: f.mark,
    }));
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
