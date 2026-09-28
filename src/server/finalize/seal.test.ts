import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { makePdf } from "../../../tests/helpers/pdf";
import { selfSignedSealP12 } from "./dev-cert";
import { loadSealKey, sealDocument, cmsSignature, type SealKey } from "./seal";
import { verifySeal } from "./verify";
import { children, readTlv } from "./der";

const has = (bin: string) => {
  try {
    execFileSync("which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const info = { name: "Stampd", reason: "Signed with Stampd", location: "stampd.test", contactInfo: "support@stampd.test", signingTime: new Date("2026-09-28T12:00:00Z") };

let seal: SealKey;
let sealed: Buffer;
beforeAll(async () => {
  seal = loadSealKey(selfSignedSealP12({ password: "pw" }), "pw");
  sealed = await sealDocument(await PDFDocument.load(await makePdf(2)), seal, info);
});

describe("loadSealKey", () => {
  it("rejects a wrong password", () => {
    expect(() => loadSealKey(selfSignedSealP12({ password: "right" }), "wrong")).toThrow(/Cannot open|wrong password/i);
  });
});

describe("sealDocument", () => {
  it("produces a PAdES seal that verifies", () => {
    expect(sealed.subarray(0, 5).toString()).toBe("%PDF-");
    expect(sealed.toString("latin1")).toContain("/SubFilter /ETSI.CAdES.detached");
    const check = verifySeal(sealed);
    expect(check).toMatchObject({ valid: true });
    if (check.valid) expect(check.signer).toContain("Stampd Document Seal");
  });

  it("signs contentType, messageDigest and signingCertificateV2, not signingTime", () => {
    const cms = cmsSignature(Buffer.from("hello"), seal);
    const signed = children(cms, children(cms, readTlv(cms, 0))[1])[0];
    const info = children(cms, children(cms, children(cms, signed).at(-1)!)[0]);
    const attrs = children(cms, info.find((t) => t.tag === 0xa0)!);
    const oids = attrs.map((a) => cms.subarray(children(cms, a)[0].contentStart, children(cms, a)[0].end).toString("hex"));
    expect(oids.sort()).toEqual(["2a864886f70d010903", "2a864886f70d010904", "2a864886f70d010910022f"].sort());
  });

  it("detects a changed byte, appended bytes and a damaged signature", () => {
    const text = sealed.toString("latin1");
    const changed = Buffer.from(sealed);
    const firstRangeLength = Number(/\/ByteRange\s*\[\s*0\s+(\d+)/.exec(text)![1]);
    const at = Math.floor(firstRangeLength / 2);
    changed[at] = changed[at] ^ 0x01;
    expect(verifySeal(changed)).toMatchObject({ valid: false, reason: expect.stringMatching(/does not match/) });

    expect(verifySeal(Buffer.concat([sealed, Buffer.from("\n% extra")]))).toMatchObject({ valid: false, reason: expect.stringMatching(/changed after/) });

    expect(verifySeal(Buffer.from("%PDF-1.7 not sealed")).valid).toBe(false);
  });

  // Rewrites the hex signature in place (same length), changing one byte of the CMS.
  function editSignature(pdf: Buffer, pick: (cms: Buffer) => number) {
    const text = pdf.toString("latin1");
    const start = text.lastIndexOf("/Contents <") + "/Contents <".length;
    const end = text.indexOf(">", start);
    const raw = Buffer.from(text.slice(start, end), "hex");
    const i = pick(raw.subarray(0, readTlv(raw, 0).end));
    raw[i] ^= 0x01;
    return Buffer.concat([pdf.subarray(0, start), Buffer.from(raw.toString("hex"), "latin1"), pdf.subarray(end)]);
  }

  it("detects a damaged signature value", () => {
    const damaged = editSignature(sealed, (cms) => cms.length - 10);
    expect(verifySeal(damaged)).toMatchObject({ valid: false, reason: expect.stringMatching(/invalid|malformed/) });
  });

  it("detects an edited certificate inside the seal", () => {
    const damaged = editSignature(sealed, (cms) => {
      const cert = seal.certs[0];
      const at = cms.indexOf(cert);
      // A byte of the subject name (the second copy of the name, after the issuer): the key stays the same.
      return at + cert.lastIndexOf(Buffer.from("Stampd Document Seal")) + 2;
    });
    expect(verifySeal(damaged)).toMatchObject({ valid: false, reason: expect.stringMatching(/certificate was changed/) });
  });

  it.runIf(has("openssl"))("verifies with OpenSSL CMS", () => {
    const dir = mkdtempSync(join(tmpdir(), "seal-"));
    const text = sealed.toString("latin1");
    const [a, b, c, d] = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/g)].at(-1)!.slice(1).map(Number);
    const raw = Buffer.from(sealed.subarray(b + 1, c - 1).toString("latin1"), "hex");
    writeFileSync(join(dir, "sig.der"), raw.subarray(0, readTlv(raw, 0).end));
    writeFileSync(join(dir, "content.bin"), Buffer.concat([sealed.subarray(a, a + b), sealed.subarray(c, c + d)]));
    const out = execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", join(dir, "sig.der"), "-binary", "-content", join(dir, "content.bin"), "-noverify", "-purpose", "any", "-out", "/dev/null"], { stdio: "pipe" });
    expect(out.toString()).toBe("");
  });

  it.runIf(has("pdfsig"))("verifies with poppler pdfsig", () => {
    const dir = mkdtempSync(join(tmpdir(), "seal-"));
    writeFileSync(join(dir, "sealed.pdf"), sealed);
    const out = execFileSync("pdfsig", [join(dir, "sealed.pdf")], { stdio: "pipe" }).toString();
    expect(out).toContain("Signature Validation: Signature is Valid.");
    expect(out).toContain("ETSI.CAdES.detached");
  });
});
