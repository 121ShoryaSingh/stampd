// Pure step logic, shared by server pages and client forms.
import type { getEnvelope } from "@/server/envelopes/service";

export const STEPS = [
  { key: "details", label: "Details" },
  { key: "upload", label: "Upload" },
  { key: "recipients", label: "Recipients" },
  { key: "fields", label: "Fields" },
  { key: "review", label: "Review and send" },
] as const;
export type StepKey = (typeof STEPS)[number]["key"];

type Draft = Awaited<ReturnType<typeof getEnvelope>>;

// What is finished; a step is open once every step before it is finished.
export function progress(d: Draft): Record<StepKey, boolean> {
  const signers = d.recipients.filter((r) => r.role === "signer");
  return {
    details: true,
    upload: !!d.document,
    recipients: signers.length > 0,
    fields: signers.length > 0 && signers.every((s) => d.fields.some((f) => f.recipientId === s.id && f.type === "signature")),
    review: false,
  };
}

export function firstOpenStep(done: Record<StepKey, boolean>): StepKey {
  return STEPS.find((s) => !done[s.key])?.key ?? "review";
}

export const reachable = (step: StepKey, done: Record<StepKey, boolean>) => STEPS.slice(0, STEPS.findIndex((s) => s.key === step)).every((s) => done[s.key]);

export const stepHref = (id: string, step: StepKey) => `/envelopes/${id}/${step}`;
