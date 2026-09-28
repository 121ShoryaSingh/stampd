import { expect } from "@playwright/test";

// Mailpit from compose.dev.yml; the e2e worker sends there.
const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:8025";

type Summary = { ID: string; Subject: string; Created: string };

// Waits for the newest email to `to` received after `since` whose subject matches.
export async function waitForMail(to: string, since: Date, subject: RegExp): Promise<{ subject: string; text: string }> {
  let found: Summary | undefined;
  await expect
    .poll(
      async () => {
        const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
        const { messages = [] } = (await res.json()) as { messages?: Summary[] };
        // Mailpit timestamps have second precision; allow a little clock slack.
        found = messages.find((m) => new Date(m.Created).getTime() >= since.getTime() - 2000 && subject.test(m.Subject));
        return !!found;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
  const msg = await (await fetch(`${MAILPIT}/api/v1/message/${found!.ID}`)).json();
  return { subject: msg.Subject, text: msg.Text };
}

// Path of the signing link in the newest invite or reminder for this envelope title.
export async function signingLink(to: string, title: string, since: Date): Promise<string> {
  const { text } = await waitForMail(to, since, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const url = text.match(/https?:\/\/\S+\/sign\/[A-Za-z0-9_-]+/)?.[0];
  if (!url) throw new Error(`No signing link in email to ${to}`);
  return new URL(url).pathname;
}

export async function signingCode(to: string, since: Date): Promise<string> {
  const { subject } = await waitForMail(to, since, /^Your Stampd code: \d{6}$/);
  return subject.slice(-6);
}
