import { inject } from "vitest";
import type { AdminDb } from "./db";
import { hashToken } from "@/server/team/service";

export type MailpitMessage = { ID: string; Subject: string; From: { Name: string; Address: string }; To: { Name: string; Address: string }[]; Text: string; HTML: string };

// Latest message Mailpit received for this address, or null.
export async function lastMailTo(address: string): Promise<MailpitMessage | null> {
  const base = inject("mailpitUrl");
  const found = await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=1`)).json();
  const id = found.messages?.[0]?.ID;
  if (!id) return null;
  return (await fetch(`${base}/api/v1/message/${id}`)).json();
}

type JobData = { url?: string; code?: string };

// Latest queued email of these kinds for a recipient, straight from the outbox.
async function lastJob(admin: AdminDb, recipientId: string, kinds: string[]) {
  const job = await admin.emailJob.findFirst({ where: { recipientId, kind: { in: kinds } }, orderBy: { createdAt: "desc" } });
  return job ? (job.data as JobData) : null;
}

// Token from the newest invite or reminder link, or null if none was issued.
export async function tokenFor(admin: AdminDb, recipientId: string): Promise<string | null> {
  const url = (await lastJob(admin, recipientId, ["invite", "reminder"]))?.url;
  return url ? url.split("/sign/")[1] : null;
}

// The code from the newest code email for the recipient behind this link.
export async function codeFor(admin: AdminDb, token: string): Promise<string> {
  const rec = await admin.recipient.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
  const code = (await lastJob(admin, rec.id, ["otp"]))?.code;
  if (!code) throw new Error("No code email queued");
  return code;
}
