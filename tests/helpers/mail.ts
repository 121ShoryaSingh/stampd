import { inject } from "vitest";

export type MailpitMessage = { ID: string; Subject: string; From: { Name: string; Address: string }; To: { Name: string; Address: string }[]; Text: string; HTML: string };

// Latest message Mailpit received for this address, or null.
export async function lastMailTo(address: string): Promise<MailpitMessage | null> {
  const base = inject("mailpitUrl");
  const found = await (await fetch(`${base}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}&limit=1`)).json();
  const id = found.messages?.[0]?.ID;
  if (!id) return null;
  return (await fetch(`${base}/api/v1/message/${id}`)).json();
}
