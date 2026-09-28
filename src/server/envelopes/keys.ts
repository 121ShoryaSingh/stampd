import { randomUUID } from "node:crypto";

export function uploadKeyFor(tenantId: string, envelopeId: string): string {
  return `t/${tenantId}/e/${envelopeId}/${randomUUID()}.pdf`;
}

const KEY_RE = /^t\/([0-9a-f-]{36})\/e\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.pdf$/;

export function isUploadKeyFor(key: string, tenantId: string, envelopeId: string): boolean {
  const m = KEY_RE.exec(key);
  return !!m && m[1] === tenantId && m[2] === envelopeId;
}

// Verified documents live here; these keys are never handed out for upload.
export function documentKeyFor(tenantId: string, envelopeId: string): string {
  return `t/${tenantId}/e/${envelopeId}/doc/${randomUUID()}.pdf`;
}
