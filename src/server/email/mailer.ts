import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/server/env";

export type OutgoingMail = { to: string; toName?: string | null; subject: string; text: string; html: string };

let transport: Transporter | undefined;

export function emailConfigured(): boolean {
  return !!env.SMTP_HOST && !!env.EMAIL_FROM_ADDRESS;
}

// Port 465 uses implicit TLS; other ports upgrade with STARTTLS when offered.
function smtpTransport(): Transporter {
  if (!emailConfigured()) throw new Error("Email is not configured: set SMTP_HOST and EMAIL_FROM_ADDRESS");
  const port = env.SMTP_PORT ?? 587;
  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transport;
}

export async function sendMail(m: OutgoingMail): Promise<void> {
  await smtpTransport().sendMail({
    from: { name: env.EMAIL_FROM_NAME ?? "Stampd", address: env.EMAIL_FROM_ADDRESS! },
    to: m.toName ? { name: m.toName, address: m.to } : m.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
  });
}
