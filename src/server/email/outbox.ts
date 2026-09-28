import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db/context";
import type { EmailData, EmailKind } from "./templates";

export type EmailJobInput<K extends EmailKind = EmailKind> = {
  tenantId: string;
  envelopeId: string;
  recipientId?: string | null;
  kind: K;
  toEmail: string;
  toName?: string | null;
  data: EmailData[K];
};

// Call inside the transaction that makes the change the email is about.
export async function enqueueEmail<K extends EmailKind>(tx: Tx, j: EmailJobInput<K>) {
  await tx.emailJob.create({
    data: {
      tenantId: j.tenantId,
      envelopeId: j.envelopeId,
      recipientId: j.recipientId ?? null,
      kind: j.kind,
      toEmail: j.toEmail,
      toName: j.toName ?? null,
      data: j.data as Prisma.InputJsonValue,
    },
  });
}
