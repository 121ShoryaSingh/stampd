// Minimal DER reading and writing for the CMS seal (no parsing library needed for these few shapes).

export type Tlv = { tag: number; start: number; contentStart: number; end: number };

export function readTlv(b: Buffer, at: number): Tlv {
  if (at + 2 > b.length) throw new Error("Truncated DER");
  const tag = b[at];
  let len = b[at + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("Unsupported DER length");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[at + 2 + i];
    header = 2 + n;
  }
  const end = at + header + len;
  if (end > b.length) throw new Error("Truncated DER");
  return { tag, start: at, contentStart: at + header, end };
}

export function children(b: Buffer, node: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let p = node.contentStart; p < node.end; ) {
    const c = readTlv(b, p);
    out.push(c);
    p = c.end;
  }
  return out;
}

export const bytesOf = (b: Buffer, t: Tlv) => b.subarray(t.start, t.end);
export const contentOf = (b: Buffer, t: Tlv) => b.subarray(t.contentStart, t.end);

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return Buffer.from([0x80 | out.length, ...out]);
}

export const tlv = (tag: number, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
export const seq = (...parts: Buffer[]) => tlv(0x30, ...parts);
export const set = (...parts: Buffer[]) => tlv(0x31, ...parts);
export const octets = (b: Buffer) => tlv(0x04, b);
export const int = (n: number) => tlv(0x02, Buffer.from([n]));
export const NULL = Buffer.from([0x05, 0x00]);

export function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

export const OIDS = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  ecdsaWithSha256: "1.2.840.10045.4.3.2",
};

// Issuer name and serial number exactly as they appear in the certificate.
export function issuerAndSerial(certDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const tbs = children(certDer, readTlv(certDer, 0))[0];
  const f = children(certDer, tbs);
  const i = f[0].tag === 0xa0 ? 1 : 0; // optional [0] version
  return { serial: bytesOf(certDer, f[i]), issuer: bytesOf(certDer, f[i + 2]) };
}
