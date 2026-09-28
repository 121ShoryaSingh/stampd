// Drop fields whose recipient was removed or turned into cc.
export function pruneOrphanFields<T extends { recipientId: string }>(fields: T[], signerIds: string[]): T[] {
  const keep = fields.filter((f) => signerIds.includes(f.recipientId));
  return keep.length === fields.length ? fields : keep;
}
