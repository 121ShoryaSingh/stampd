// Creates a self-issued seal certificate for local development: .secrets/seal-dev.p12
// PDF readers show "identity unknown" for it; production needs a CA-issued document-signing certificate.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { selfSignedSealP12 } from "../src/server/finalize/dev-cert";

const path = ".secrets/seal-dev.p12";
if (existsSync(path) && !process.argv.includes("--force")) {
  console.log(`${path} already exists (use --force to replace it).`);
  process.exit(0);
}
const password = randomBytes(12).toString("base64url");
mkdirSync(".secrets", { recursive: true });
writeFileSync(path, selfSignedSealP12({ password, commonName: "Stampd Dev Seal (self-issued)" }), { mode: 0o600 });
console.log(`Wrote ${path}. Add to .env.local:\n\nSEAL_P12_PATH=${path}\nSEAL_P12_PASSWORD=${password}\n`);
