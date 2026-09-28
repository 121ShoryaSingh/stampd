import { createHash, verify as verifyBytes, X509Certificate } from "node:crypto";
import { OIDS, bytesOf, children, contentOf, issuerAndSerial, oid, readTlv, seq } from "./der";

export type SealCheck = { valid: true; signer: string; certificate: X509Certificate } | { valid: false; reason: string };

const fail = (reason: string): SealCheck => ({ valid: false, reason });

// Checks the last PDF signature: it must cover the whole file and match its signed digest.
export function verifySeal(pdf: Buffer): SealCheck {
  const ranges = [...pdf.toString("latin1").matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const last = ranges.at(-1);
  if (!last) return fail("The PDF is not sealed");
  const [a, b, c, d] = last.slice(1).map(Number);
  if (a !== 0 || c + d !== pdf.length) return fail("The PDF was changed after it was sealed");
  if (pdf[b] !== 0x3c || pdf[c - 1] !== 0x3e) return fail("The seal is malformed");
  try {
    const hex = pdf.subarray(b + 1, c - 1).toString("latin1");
    const raw = Buffer.from(hex, "hex");
    const cms = raw.subarray(0, readTlv(raw, 0).end);
    const [contentType, wrapped] = children(cms, readTlv(cms, 0));
    if (!bytesOf(cms, contentType).equals(oid(OIDS.signedData))) return fail("The seal is not a CMS signature");
    const signedData = children(cms, children(cms, wrapped)[0]);
    const certs = signedData.filter((t) => t.tag === 0xa0).flatMap((t) => children(cms, t).map((c) => bytesOf(cms, c)));
    const signerInfo = children(cms, children(cms, signedData.at(-1)!)[0]);
    const sid = bytesOf(cms, signerInfo[1]);
    const attrsTlv = signerInfo.find((t) => t.tag === 0xa0);
    if (!attrsTlv) return fail("The seal has no signed attributes");
    const signature = contentOf(cms, signerInfo.find((t, i) => i > 0 && t.tag === 0x04)!);

    const content = Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]);
    const digest = children(cms, attrsTlv)
      .map((t) => children(cms, t))
      .find(([type]) => bytesOf(cms, type).equals(oid(OIDS.messageDigest)));
    if (!digest) return fail("The seal has no document digest");
    const signedDigest = contentOf(cms, children(cms, digest[1])[0]);
    if (!signedDigest.equals(createHash("sha256").update(content).digest())) return fail("The document does not match its seal");
    const certRef = children(cms, attrsTlv)
      .map((t) => children(cms, t))
      .find(([type]) => bytesOf(cms, type).equals(oid(OIDS.signingCertificateV2)));
    if (!certRef) return fail("The seal does not name its certificate");

    const certDer = certs.find((c) => {
      const { issuer, serial } = issuerAndSerial(c);
      return seq(issuer, serial).equals(sid);
    });
    if (!certDer) return fail("The seal has no certificate");
    // The signed ESSCertIDv2 pins the certificate, so a swapped or edited certificate is caught.
    const essCertId = children(cms, children(cms, children(cms, children(cms, certRef[1])[0])[0])[0]);
    const hashAt = essCertId[0].tag === 0x30 ? 1 : 0; // skip an explicit hashAlgorithm
    if (hashAt === 1 && !bytesOf(cms, children(cms, essCertId[0])[0]).equals(oid(OIDS.sha256))) return fail("Unsupported certificate hash");
    if (!contentOf(cms, essCertId[hashAt]).equals(createHash("sha256").update(certDer).digest())) return fail("The seal certificate was changed");
    const cert = new X509Certificate(certDer);
    // Signed attributes are signed as a SET (tag 0x31), not as the stored [0] tag.
    const attrs = Buffer.from(bytesOf(cms, attrsTlv));
    attrs[0] = 0x31;
    if (!verifyBytes("sha256", attrs, cert.publicKey, signature)) return fail("The seal signature is invalid");
    return { valid: true, signer: cert.subject, certificate: cert };
  } catch {
    return fail("The seal is malformed");
  }
}
