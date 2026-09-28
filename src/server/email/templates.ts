import "server-only";

export type EmailKind = "invite" | "reminder" | "otp" | "declined" | "completed" | "expired" | "voided";

export type EmailData = {
  invite: { title: string; senderName: string; recipientName: string; message?: string | null; url: string; expiresAt: string };
  reminder: { title: string; senderName: string; recipientName: string; url: string; expiresAt: string };
  otp: { title: string; code: string };
  declined: { title: string; signerName: string; signerEmail: string; reason: string; envelopeUrl: string };
  completed: { title: string; envelopeUrl: string };
  expired: { title: string; envelopeUrl: string };
  voided: { title: string; senderName: string; reason: string };
};

export type RenderedEmail = { subject: string; text: string; html: string };

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

// Subjects are one line: header injection and runaway titles are cut here.
function subjectLine(s: string): string {
  return s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150);
}

const day = (iso: string) => new Date(iso).toUTCString().slice(0, 16);

type Block = { kind: "p"; text: string } | { kind: "quote"; text: string } | { kind: "button"; label: string; url: string } | { kind: "code"; text: string };

// One layout for every email: plain text plus a simple, escaped HTML version.
function layout(subject: string, heading: string, blocks: Block[]): RenderedEmail {
  const text = [
    heading,
    ...blocks.map((b) => (b.kind === "button" ? `${b.label}: ${b.url}` : b.kind === "quote" ? b.text.split("\n").map((l) => `> ${l}`).join("\n") : b.text)),
    "-- Stampd",
  ].join("\n\n");
  const body = blocks
    .map((b) => {
      if (b.kind === "p") return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5">${escapeHtml(b.text)}</p>`;
      if (b.kind === "quote") return `<p style="margin:0 0 16px;padding:12px;border:2px solid #000;background:#FFE600;white-space:pre-wrap">${escapeHtml(b.text)}</p>`;
      if (b.kind === "code") return `<p style="margin:0 0 16px;font-family:monospace;font-size:32px;letter-spacing:6px;font-weight:bold">${escapeHtml(b.text)}</p>`;
      return `<p style="margin:24px 0"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:12px 20px;border:2px solid #000;background:#FF3D00;color:#000;font-weight:bold;text-decoration:none">${escapeHtml(b.label)}</a></p><p style="margin:0 0 16px;font-size:12px;word-break:break-all">${escapeHtml(b.url)}</p>`;
    })
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fff;color:#000;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;border:3px solid #000;padding:24px"><p style="margin:0 0 16px;font-weight:bold;letter-spacing:1px">STAMPD</p><h1 style="margin:0 0 16px;font-size:22px">${escapeHtml(heading)}</h1>${body}</div></body></html>`;
  return { subject: subjectLine(subject), text, html };
}

export function renderEmail<K extends EmailKind>(kind: K, data: EmailData[K]): RenderedEmail {
  switch (kind) {
    case "invite": {
      const d = data as EmailData["invite"];
      return layout(`${d.senderName} sent you "${d.title}" to sign`, `Please sign: ${d.title}`, [
        { kind: "p", text: `Hi ${d.recipientName}, ${d.senderName} asked you to sign "${d.title}".` },
        ...(d.message ? [{ kind: "quote" as const, text: d.message }] : []),
        { kind: "button", label: "Review and sign", url: d.url },
        { kind: "p", text: `This link is personal to you. It works until ${day(d.expiresAt)} or until a newer email replaces it.` },
      ]);
    }
    case "reminder": {
      const d = data as EmailData["reminder"];
      return layout(`Reminder: "${d.title}" is waiting for your signature`, `Reminder: ${d.title}`, [
        { kind: "p", text: `Hi ${d.recipientName}, ${d.senderName} is still waiting for your signature on "${d.title}".` },
        { kind: "button", label: "Review and sign", url: d.url },
        { kind: "p", text: `This new link replaces the one in earlier emails. It works until ${day(d.expiresAt)}.` },
      ]);
    }
    case "otp": {
      const d = data as EmailData["otp"];
      return layout(`Your Stampd code: ${d.code}`, "Your signing code", [
        { kind: "p", text: `Use this code to open "${d.title}". It expires in 10 minutes.` },
        { kind: "code", text: d.code },
        { kind: "p", text: "If you did not ask for this code, you can ignore this email." },
      ]);
    }
    case "declined": {
      const d = data as EmailData["declined"];
      return layout(`${d.signerName} declined "${d.title}"`, `Declined: ${d.title}`, [
        { kind: "p", text: `${d.signerName} (${d.signerEmail}) declined to sign. Their reason:` },
        { kind: "quote", text: d.reason },
        { kind: "button", label: "Open envelope", url: d.envelopeUrl },
      ]);
    }
    case "completed": {
      const d = data as EmailData["completed"];
      return layout(`Completed: "${d.title}"`, `Everyone signed: ${d.title}`, [
        { kind: "p", text: "All signers have signed. The sealed PDF will be ready on the envelope page." },
        { kind: "button", label: "Open envelope", url: d.envelopeUrl },
      ]);
    }
    case "expired": {
      const d = data as EmailData["expired"];
      return layout(`Expired: "${d.title}"`, `Expired: ${d.title}`, [
        { kind: "p", text: "This envelope expired before everyone signed. You can create a new one to try again." },
        { kind: "button", label: "Open envelope", url: d.envelopeUrl },
      ]);
    }
    case "voided": {
      const d = data as EmailData["voided"];
      return layout(`Cancelled: "${d.title}"`, `Cancelled: ${d.title}`, [
        { kind: "p", text: `${d.senderName} cancelled this envelope. You do not need to sign it. Their reason:` },
        { kind: "quote", text: d.reason },
      ]);
    }
  }
  throw new Error(`Unknown email kind: ${String(kind)}`);
}
