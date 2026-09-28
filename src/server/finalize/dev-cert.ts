import forge from "node-forge";
import { generateKeyPairSync, randomBytes } from "node:crypto";

// A self-issued seal certificate for development and tests. Readers show "identity unknown";
// production should use a document-signing certificate from a trusted CA.
export function selfSignedSealP12(o: { commonName?: string; organization?: string; password: string; years?: number }): Buffer {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = forge.pki.privateKeyFromPem(privateKey.export({ type: "pkcs1", format: "pem" }).toString());
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey.export({ type: "spki", format: "pem" }).toString());
  cert.serialNumber = `01${randomBytes(15).toString("hex")}`; // positive, 16 bytes
  cert.validity.notBefore = new Date(Date.now() - 60_000);
  cert.validity.notAfter = new Date(Date.now() + (o.years ?? 3) * 365 * 86_400_000);
  const name = [
    { name: "commonName", value: o.commonName ?? "Stampd Document Seal (self-issued)" },
    { name: "organizationName", value: o.organization ?? "Stampd" },
  ];
  cert.setSubject(name);
  cert.setIssuer(name);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, nonRepudiation: true },
    { name: "subjectKeyIdentifier" },
  ]);
  cert.sign(key, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], o.password, { algorithm: "aes256", friendlyName: "stampd-seal" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}
