// Human wording for audit events; recipient events name the signer.
const WORDS: Record<string, (who: string) => string> = {
  created: () => "Envelope created",
  document_uploaded: () => "PDF uploaded",
  recipients_updated: () => "Recipients updated",
  fields_updated: () => "Fields placed",
  sent: () => "Sent for signature",
  viewed: (w) => `${w} opened the envelope`,
  otp_sent: (w) => `Code sent to ${w}`,
  otp_verified: (w) => `${w} verified their code`,
  otp_failed: (w) => `${w} entered a wrong code`,
  consented: (w) => `${w} agreed to sign electronically`,
  signed: (w) => `${w} signed`,
  declined: (w) => `${w} declined`,
  step_started: () => "Next signers were invited",
  completed: () => "Everyone signed",
  voided: () => "Envelope voided",
  expired: () => "Envelope expired",
  email_sent: () => "Email sent",
  email_failed: () => "An email could not be delivered",
  reminded: () => "Reminder sent",
  link_reissued: () => "Signing link sent again",
};

export function describeEvent(event: string, who: string) {
  return (WORDS[event] ?? (() => event.replace(/_/g, " ")))(who);
}

export function relativeTime(d: Date, now = new Date()) {
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604_800) return `${Math.floor(s / 86_400)} d ago`;
  return d.toISOString().slice(0, 10);
}
