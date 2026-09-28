import type { CertificateData } from "@/server/finalize/certificate";

const at = (m: number) => new Date(Date.UTC(2026, 8, 28, 10, m, 0));

export function sampleCertificate(events = 6): CertificateData {
  return {
    envelopeId: "0192f000-0000-7000-8000-000000000001",
    title: "Service Agreement <2026>",
    sender: { name: "Sam Sender", email: "sam@acme.test" },
    sentAt: at(0),
    completedAt: at(30),
    document: { filename: "service-agreement.pdf", pageCount: 3, sha256: "a".repeat(64) },
    recipients: [
      { id: "r1", name: "Zoë Иванова", email: "zoe@x.test", role: "signer", status: "signed", routingOrder: 1, viewedAt: at(1), otpVerifiedAt: at(2), consentedAt: at(3), signedAt: at(4), signIp: "203.0.113.7", signUserAgent: "Mozilla/5.0 (iPhone)" },
      { id: "r2", name: "李 明", email: "li@x.test", role: "signer", status: "signed", routingOrder: 2, viewedAt: at(10), otpVerifiedAt: at(11), consentedAt: at(12), signedAt: at(13), signIp: "198.51.100.2", signUserAgent: null },
      { id: "r3", name: "Carl Copy", email: "carl@x.test", role: "cc", status: "pending", routingOrder: 1, viewedAt: null, otpVerifiedAt: null, consentedAt: null, signedAt: null, signIp: null, signUserAgent: null },
    ],
    events: Array.from({ length: events }, (_, i) => ({ seq: i + 1, createdAt: at(i), event: i === 0 ? "sent" : "signed", actorType: i === 0 ? "user" : "recipient", actorId: i === 0 ? "u1" : "r1", ip: i === 0 ? null : "203.0.113.7" })),
    actors: { u1: "Sam Sender" },
    auditHash: "b".repeat(64),
    generatedAt: at(31),
  };
}
