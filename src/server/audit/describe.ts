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
  sealed: () => "Signed PDF sealed",
  seal_failed: () => "Sealing the signed PDF failed",
  seal_retried: () => "Sealing restarted",
};

export function describeEvent(event: string, who: string) {
  return (WORDS[event] ?? (() => event.replace(/_/g, " ")))(who);
}
