import type { AdminDb } from "./db";

export async function seedDraft(db: AdminDb, tenantId: string, userId: string, title = "Draft") {
  const e = await db.envelope.create({ data: { tenantId, createdBy: userId, title } });
  return e.id;
}
