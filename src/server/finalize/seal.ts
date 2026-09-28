import forge from "node-forge";
import { createHash, createPrivateKey, createPublicKey, sign as signBytes, X509Certificate, type KeyObject } from "node:crypto";
import type { PDFDocument } from "pdf-lib";
import { SignPdf, Signer } from "@signpdf/signpdf";
import { pdflibAddPlaceholder } from "@signpdf/placeholder-pdf-lib";
import { SUBFILTER_ETSI_CADES_DETACHED } from "@signpdf/utils";
import { NULL, OIDS, int, issuerAndSerial, octets, oid, seq, set, tlv } from "./der";

// certs[0] signs; the rest (intermediates) are embedded so readers can build the chain.
export type SealKey = { key: KeyObject; certs: Buffer[] };

const der = (node: forge.asn1.Asn1) => Buffer.from(forge.asn1.toDer(node).getBytes(), "binary");

// Reads a PKCS#12 (.p12/.pfx) file: RSA or EC key plus its certificate chain.
export function loadSealKey(p12: Buffer, password: string): SealKey {
  const { oids } = forge.pki;
  let bundle: forge.pkcs12.Pkcs12Pfx;
  try {
    bundle = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(p12.toString("binary")), false, password);
  } catch (e) {
    throw new Error(`Cannot open the seal certificate: ${e instanceof Error ? e.message : String(e)}`);
  }
  const bags = (type: string) => bundle.getBags({ bagType: type })[type] ?? [];
  const keyBag = [...bags(oids.pkcs8ShroudedKeyBag), ...bags(oids.keyBag)][0];
  if (!keyBag) throw new Error("The seal certificate file has no private key");
  // forge only understands RSA keys; other key types come back as raw PKCS#8.
  const pkcs8 = keyBag.key ? forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keyBag.key)) : keyBag.asn1;
  if (!pkcs8) throw new Error("The seal certificate file has an unreadable private key");
  const key = createPrivateKey({ key: der(pkcs8), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "rsa" && key.asymmetricKeyType !== "ec") throw new Error("The seal key must be RSA or EC");

  const certs = bags(oids.certBag).map((b) => der(b.cert ? forge.pki.certificateToAsn1(b.cert) : b.asn1!));
  const pub = createPublicKey(key).export({ type: "spki", format: "der" });
  const x509 = certs.map((c) => new X509Certificate(c));
  const i = x509.findIndex((c) => c.publicKey.export({ type: "spki", format: "der" }).equals(pub));
  if (i < 0) throw new Error("No certificate in the seal file matches its private key");
  const issuer = x509.find((c) => x509[i].checkIssued(c));
  if (issuer && !x509[i].verify(issuer.publicKey)) throw new Error("The seal certificate failed its signature check");
  return { key, certs: [certs[i], ...certs.filter((_, j) => j !== i)] };
}

// CMS SignedData for PAdES (ETSI.CAdES.detached): contentType, messageDigest and
// signingCertificateV2 are signed; the signing time lives in the PDF signature dictionary.
export function cmsSignature(content: Buffer, seal: SealKey): Buffer {
  const cert = seal.certs[0];
  const { issuer, serial } = issuerAndSerial(cert);
  const attrs = [
    seq(oid(OIDS.contentType), set(oid(OIDS.data))),
    seq(oid(OIDS.messageDigest), set(octets(createHash("sha256").update(content).digest()))),
    // ESSCertIDv2 with the default hash (SHA-256): certHash plus issuerSerial.
    seq(oid(OIDS.signingCertificateV2), set(seq(seq(seq(octets(createHash("sha256").update(cert).digest()), seq(seq(tlv(0xa4, issuer)), serial)))))),
  ].sort(Buffer.compare); // DER orders SET OF by encoding
  const signature = signBytes("sha256", set(...attrs), seal.key);
  const algorithm = seal.key.asymmetricKeyType === "ec" ? seq(oid(OIDS.ecdsaWithSha256)) : seq(oid(OIDS.rsaEncryption), NULL);
  const signerInfo = seq(int(1), seq(issuer, serial), seq(oid(OIDS.sha256)), tlv(0xa0, ...attrs), algorithm, octets(signature));
  const signedData = seq(int(1), set(seq(oid(OIDS.sha256))), seq(oid(OIDS.data)), tlv(0xa0, ...seal.certs), set(signerInfo));
  return seq(oid(OIDS.signedData), tlv(0xa0, signedData));
}

class CmsSigner extends Signer {
  constructor(private seal: SealKey) {
    super();
  }
  async sign(content: Buffer): Promise<Buffer> {
    return cmsSignature(content, this.seal);
  }
}

export type SealInfo = { name: string; reason: string; location: string; contactInfo: string; signingTime: Date };

// Adds an invisible PAdES signature over the whole file; any later change breaks it.
export async function sealDocument(doc: PDFDocument, seal: SealKey, info: SealInfo): Promise<Buffer> {
  pdflibAddPlaceholder({
    pdfDoc: doc,
    name: info.name,
    reason: info.reason,
    location: info.location,
    contactInfo: info.contactInfo,
    signingTime: info.signingTime,
    subFilter: SUBFILTER_ETSI_CADES_DETACHED,
    signatureLength: 16_384,
    appName: "Stampd",
  });
  // The /ByteRange placeholder must stay searchable, so no compressed object streams.
  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return new SignPdf().sign(bytes, new CmsSigner(seal), info.signingTime);
}
